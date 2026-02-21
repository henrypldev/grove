import { generateId, log } from '../config'
import type { Agent, Team } from '../types'
import { spawnAgent } from './runner'

const PM_PROMPT = (team: Team, agentId: string) => `
You are the PM for team ${team.id}. You persist until the task is fully complete.
Your agent ID: ${agentId}
Task: ${team.task}
Worktree: ${team.worktreePath}
API: http://localhost:4002

PHASE 1 — PLAN
Write a coordination plan and post it (this signals the Team Lead to start):
curl -s -X POST http://localhost:4002/v2/events \\
  -H "Content-Type: application/json" \\
  -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"pm:plan","payload":{"plan":"YOUR_PLAN"}}'

PHASE 2 — MONITOR (poll loop)
Poll for new events every 20 seconds:
  curl -s "http://localhost:4002/v2/teams/${team.id}/events?since=LAST_TIMESTAMP"

Track which events you've already acted on. React as follows:

  team-lead:plan received
    → Technical plan is ready. Dev will self-trigger. No action needed.

  dev:complete received (and no pending rework)
    → QA will self-trigger. No action needed.

  qa:result received with passed=false (track iteration count, max 3)
    → Post pm:rework with the QA feedback so Dev can fix it:
      {"type":"pm:rework","payload":{"iteration":N,"feedback":"FEEDBACK"}}

  qa:result received with passed=true
    → Reviewer will self-trigger. No action needed.

  reviewer:result received with approved=false (track iteration count, max 3)
    → Post pm:rework with the reviewer feedback:
      {"type":"pm:rework","payload":{"iteration":N,"feedback":"FEEDBACK"}}

  reviewer:result received with approved=true
    → Signal Dev to commit and open a PR:
      {"type":"pm:assign-pr","payload":{}}

  dev:pr-created received
    → Proceed to PHASE 3

  If max retries (3) exceeded for QA or review:
    → Post {"type":"pm:blocked","payload":{"reason":"..."}} and exit

PHASE 3 — SUMMARISE AND EXIT
1. Fetch all team events: curl -s "http://localhost:4002/v2/teams/${team.id}/events?since=0"
2. Write a concise summary of what was built, decisions made, issues encountered, and the PR URL
3. Post pm:summary (this signals all agents to exit):
   {"type":"pm:summary","payload":{"summary":"YOUR_SUMMARY"}}
4. Exit
`

type Callbacks = { onDone: () => void; onError: () => void }

export async function spawnPm(team: Team, callbacks: Callbacks): Promise<Agent> {
	log('pm', 'spawning PM', { teamId: team.id })
	const agentId = generateId()
	return spawnAgent({
		agentId,
		teamId: team.id,
		role: 'pm',
		prompt: PM_PROMPT(team, agentId),
		cwd: team.worktreePath,
		maxBudgetUsd: 10,
		allowedTools: ['Bash'],
		onDone: callbacks.onDone,
		onError: callbacks.onError,
	})
}
