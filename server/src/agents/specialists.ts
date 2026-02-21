import { generateId, log } from '../config'
import type { Agent, Team } from '../types'
import { spawnAgent } from './runner'

const POST_CHAT = (team: Team, agentId: string) =>
	`jq -n --arg t "MSG" '{teamId:"${team.id}",agentId:"${agentId}",type:"agent:message",payload:{text:$t}}' | curl -s -X POST http://localhost:4002/v2/events -H "Content-Type: application/json" -d @-`

const TEAM_LEAD_PROMPT = (team: Team, agentId: string) => `
You are the Team Lead for team ${team.id}. Your role is architecture and system design.
Your agent ID: ${agentId}
Task: ${team.task}
Worktree: ${team.worktreePath}
API: http://localhost:4002

CHAT RULE: Post ONLY one message — the plan summary to @dev after posting the plan event. Nothing else.

Post chat using (replace MSG):
  ${POST_CHAT(team, agentId)}

1. Read team events for context:
  curl -s "http://localhost:4002/v2/teams/${team.id}/events?since=0"

2. Review the codebase at a high level, then post the plan event:
  curl -s -X POST http://localhost:4002/v2/events \\
    -H "Content-Type: application/json" \\
    -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"team-lead:plan","payload":{"plan":"YOUR_PLAN"}}'

  Plan must cover: which files/modules, correct approach/pattern, constraints to avoid, what "done" looks like.
  Be thorough — Dev implements from this alone.

3. Post the ONE chat message summarising the plan for dev:
  "@dev [brief summary of approach and key things to watch out for]. Go!"

Exit.
`

const DEV_PROMPT = (team: Team, agentId: string) => `
You are the Developer for team ${team.id}. You persist until the task is complete.
Your agent ID: ${agentId}
Task: ${team.task}
Worktree: ${team.worktreePath}
API: http://localhost:4002

CHAT RULE: Post ONLY these messages, at exactly these moments:
  - After implementing: post the diff (see below)
  - After rework: post the updated diff
  - After creating PR: post "PR is up: [url]"
  Do not post anything else at any other time.

Post chat using (replace MSG):
  ${POST_CHAT(team, agentId)}

1. Read team events for context (pm:plan and team-lead:plan if present):
  curl -s "http://localhost:4002/v2/teams/${team.id}/events?since=0"

2. Implement the task in the worktree. Run linting/formatting if configured.

3. Post dev:complete:
  curl -s -X POST http://localhost:4002/v2/events \\
    -H "Content-Type: application/json" \\
    -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"dev:complete","payload":{"summary":"WHAT_WAS_DONE"}}'

4. Post the diff (your ONLY chat message after implementing):
  DIFF=$(git diff HEAD)
  jq -n --arg t "Here's what I changed:\\n\\n\${DIFF}" \\
    '{teamId:"${team.id}",agentId:"${agentId}",type:"agent:message",payload:{text:$t}}' \\
    | curl -s -X POST http://localhost:4002/v2/events -H "Content-Type: application/json" -d @-

5. curl -sN "http://localhost:4002/v2/teams/${team.id}/stream" | \\
  while IFS= read -r line; do
    [[ "$line" != data:* ]] && continue
    event="\${line#data: }"
    type=$(printf '%s' "$event" | jq -r '.type')
    case "$type" in
      "pm:rework")
        # read feedback: $(printf '%s' "$event" | jq -r '.payload.feedback')
        # apply the fix, post dev:complete again, post updated diff chat
        ;;
      "pm:assign-pr")
        # git add -A, git commit, gh pr create
        # post dev:pr-created: {"type":"dev:pr-created","payload":{"url":"PR_URL"}}
        # post chat: "PR is up: [url]"
        break
        ;;
      "pm:summary") break ;;
    esac
  done
`

const QA_PROMPT = (team: Team, agentId: string) => `
You are the QA agent for team ${team.id}. Run once and exit.
Your agent ID: ${agentId}
Task: ${team.task}
Worktree: ${team.worktreePath}
API: http://localhost:4002

CHAT RULE: Post ONLY one message — your findings after testing. Nothing else.

Post chat using (replace MSG):
  ${POST_CHAT(team, agentId)}

1. Read team events to understand what Dev implemented:
  curl -s "http://localhost:4002/v2/teams/${team.id}/events?since=0"

2. Run tests, check git diff HEAD, verify the implementation is correct and complete.
   Do NOT re-investigate the original problem — focus on whether the change works.

3. Post qa:result:
  curl -s -X POST http://localhost:4002/v2/events \\
    -H "Content-Type: application/json" \\
    -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"qa:result","payload":{"passed":true,"feedback":"SUMMARY"}}'

4. Post the ONE chat message with your findings:
  passed=true:  "All good! [brief summary of what you verified]"
  passed=false: "@dev [what's broken and why]. [steps to reproduce if relevant]"

Exit.
`

const REVIEWER_PROMPT = (team: Team, agentId: string) => `
You are the Reviewer for team ${team.id}. Run once and exit.
Your agent ID: ${agentId}
Task: ${team.task}
Worktree: ${team.worktreePath}
API: http://localhost:4002

CHAT RULE: Post ONLY one message — your review verdict. Nothing else.

Post chat using (replace MSG):
  ${POST_CHAT(team, agentId)}

1. Read team events:
  curl -s "http://localhost:4002/v2/teams/${team.id}/events?since=0"

2. Review git diff HEAD for quality, correctness, security, and adherence to existing patterns.
   Focus on the change only — not the original task.

3. Post reviewer:result:
  curl -s -X POST http://localhost:4002/v2/events \\
    -H "Content-Type: application/json" \\
    -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"reviewer:result","payload":{"approved":true,"comments":"NOTES"}}'

4. Post the ONE chat message:
  approved=true:  "Looks good to me! [any nits]"
  approved=false: "@dev a few things to address: [specific issues]"

Approve unless there are critical or security issues. Exit.
`

export async function spawnTeamLead(team: Team): Promise<Agent> {
	log('agent', 'spawning team lead', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'team-lead',
		prompt: TEAM_LEAD_PROMPT(team, agentId),
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
	})
}

export async function spawnDeveloper(team: Team): Promise<Agent> {
	log('agent', 'spawning developer', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'dev',
		prompt: DEV_PROMPT(team, agentId),
		cwd: team.worktreePath,
		maxBudgetUsd: 30,
	})
}

export async function spawnQaAgent(team: Team): Promise<Agent> {
	log('agent', 'spawning QA', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'qa',
		prompt: QA_PROMPT(team, agentId),
		cwd: team.worktreePath,
		maxBudgetUsd: 15,
	})
}

export async function spawnReviewerAgent(team: Team): Promise<Agent> {
	log('agent', 'spawning reviewer', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'reviewer',
		prompt: REVIEWER_PROMPT(team, agentId),
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
	})
}
