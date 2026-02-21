import { generateId, log } from '../config'
import type { Agent, Team } from '../types'
import { spawnAgent } from './runner'

const POST_CHAT = (team: Team, agentId: string) =>
	`jq -n --arg t "MSG" '{teamId:"${team.id}",agentId:"${agentId}",type:"agent:message",payload:{text:$t}}' | curl -s -X POST http://localhost:4002/v2/events -H "Content-Type: application/json" -d @-`

const PM_PROMPT = (team: Team, agentId: string) => `
You are the PM for team ${team.id}. You persist until the task is fully complete.
Your agent ID: ${agentId}
Task: ${team.task}
Worktree: ${team.worktreePath}
API: http://localhost:4002

DO NOT read files, explore the codebase, or investigate any code. You spawn agents and route events.

CHAT RULE: Post ONLY the two messages described below (intro and closing). The shell loop handles all other messages automatically. Do not post anything else.

Post chat using:
  ${POST_CHAT(team, agentId)}

---

Based on the task description alone, decide if this is a FEATURE or BUG FIX.

1. Post the pm:plan event:
  curl -s -X POST http://localhost:4002/v2/events \\
    -H "Content-Type: application/json" \\
    -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"pm:plan","payload":{"plan":"YOUR_PLAN"}}'

2. Spawn the first agent:
  FEATURE → curl -s -X POST http://localhost:4002/v2/teams/${team.id}/agents -H "Content-Type: application/json" -d '{"role":"team-lead"}'
  BUG FIX → curl -s -X POST http://localhost:4002/v2/teams/${team.id}/agents -H "Content-Type: application/json" -d '{"role":"dev"}'

3. Post the INTRO chat message (the only free-form message you write):
  FEATURE → "Hey team! We're building [brief description]. @team-lead please kick us off with a technical plan."
  BUG FIX → "Hey team! We need to fix [brief description]. @dev you're up."

4. Run this coordination loop (do not post any chat before running it):

  qa_retries=0
  reviewer_retries=0
  while IFS= read -r line; do
    [[ "$line" != data:* ]] && continue
    event="\${line#data: }"
    type=$(printf '%s' "$event" | jq -r '.type')
    case "$type" in
      "team-lead:plan")
        curl -s -X POST http://localhost:4002/v2/teams/${team.id}/agents \\
          -H "Content-Type: application/json" -d '{"role":"dev"}' > /dev/null
        jq -n --arg t "@dev the technical plan is ready. You're up!" \\
          '{teamId:"${team.id}",agentId:"${agentId}",type:"agent:message",payload:{text:$t}}' \\
          | curl -s -X POST http://localhost:4002/v2/events -H "Content-Type: application/json" -d @-
        ;;
      "dev:complete")
        curl -s -X POST http://localhost:4002/v2/teams/${team.id}/agents \\
          -H "Content-Type: application/json" -d '{"role":"qa"}' > /dev/null
        jq -n --arg t "@qa implementation is ready for testing!" \\
          '{teamId:"${team.id}",agentId:"${agentId}",type:"agent:message",payload:{text:$t}}' \\
          | curl -s -X POST http://localhost:4002/v2/events -H "Content-Type: application/json" -d @-
        ;;
      "qa:result")
        passed=$(printf '%s' "$event" | jq -r '.payload.passed')
        if [ "$passed" = "false" ]; then
          qa_retries=$((qa_retries + 1))
          if [ $qa_retries -ge 3 ]; then
            curl -s -X POST http://localhost:4002/v2/events \\
              -H "Content-Type: application/json" \\
              -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"pm:blocked","payload":{"reason":"QA failed 3 times"}}'
            break
          fi
          feedback=$(printf '%s' "$event" | jq -r '.payload.feedback')
          curl -s -X POST http://localhost:4002/v2/events \\
            -H "Content-Type: application/json" \\
            -d "{\"teamId\":\"${team.id}\",\"agentId\":\"${agentId}\",\"type\":\"pm:rework\",\"payload\":{\"feedback\":\"\$feedback\"}}"
          jq -n --arg t "@dev QA found some issues (attempt \$qa_retries/3): \$feedback" \\
            '{teamId:"${team.id}",agentId:"${agentId}",type:"agent:message",payload:{text:$t}}' \\
            | curl -s -X POST http://localhost:4002/v2/events -H "Content-Type: application/json" -d @-
        else
          curl -s -X POST http://localhost:4002/v2/teams/${team.id}/agents \\
            -H "Content-Type: application/json" -d '{"role":"reviewer"}' > /dev/null
          jq -n --arg t "@reviewer QA passed! Ready for your review." \\
            '{teamId:"${team.id}",agentId:"${agentId}",type:"agent:message",payload:{text:$t}}' \\
            | curl -s -X POST http://localhost:4002/v2/events -H "Content-Type: application/json" -d @-
        fi
        ;;
      "reviewer:result")
        approved=$(printf '%s' "$event" | jq -r '.payload.approved')
        if [ "$approved" = "false" ]; then
          reviewer_retries=$((reviewer_retries + 1))
          if [ $reviewer_retries -ge 3 ]; then
            curl -s -X POST http://localhost:4002/v2/events \\
              -H "Content-Type: application/json" \\
              -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"pm:blocked","payload":{"reason":"Reviewer rejected 3 times"}}'
            break
          fi
          comments=$(printf '%s' "$event" | jq -r '.payload.comments')
          curl -s -X POST http://localhost:4002/v2/events \\
            -H "Content-Type: application/json" \\
            -d "{\"teamId\":\"${team.id}\",\"agentId\":\"${agentId}\",\"type\":\"pm:rework\",\"payload\":{\"feedback\":\"\$comments\"}}"
          jq -n --arg t "@dev reviewer has some feedback (attempt \$reviewer_retries/3): \$comments" \\
            '{teamId:"${team.id}",agentId:"${agentId}",type:"agent:message",payload:{text:$t}}' \\
            | curl -s -X POST http://localhost:4002/v2/events -H "Content-Type: application/json" -d @-
        else
          curl -s -X POST http://localhost:4002/v2/events \\
            -H "Content-Type: application/json" \\
            -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"pm:assign-pr","payload":{}}'
          jq -n --arg t "@dev everything looks great! Please open a PR." \\
            '{teamId:"${team.id}",agentId:"${agentId}",type:"agent:message",payload:{text:$t}}' \\
            | curl -s -X POST http://localhost:4002/v2/events -H "Content-Type: application/json" -d @-
        fi
        ;;
      "dev:pr-created")
        break
        ;;
    esac
  done < <(curl -sN "http://localhost:4002/v2/teams/${team.id}/stream")

5. Fetch all events, post pm:summary, post the CLOSING chat message, then exit:
  curl -s "http://localhost:4002/v2/teams/${team.id}/events?since=0"
  curl -s -X POST http://localhost:4002/v2/events \\
    -H "Content-Type: application/json" \\
    -d '{"teamId":"${team.id}","agentId":"${agentId}","type":"pm:summary","payload":{"summary":"YOUR_SUMMARY"}}'
  # closing chat: "Great work team! Here's what we shipped: [summary]."
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
