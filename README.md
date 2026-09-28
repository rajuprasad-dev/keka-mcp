# Keka employee MCP

Read your own [Keka](https://www.keka.com/) employee dashboard from any MCP client. It uses the signed-in session from your browser. It does not use admin API keys, and it does not see other employees.

The server speaks stdio, the transport Cursor, VS Code, Claude, Windsurf, Cline, Continue, Zed, Codex, Gemini CLI, and Goose all start the same way: one `npx` command. Node.js 20 or newer is the only install requirement.

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.png)](cursor://anysphere.cursor-deeplink/mcp/install?name=keka&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImdpdGh1YjpyYWp1cHJhc2FkLWRldi9rZWthLW1jcCJdfQ%3D%3D)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=keka&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Arajuprasad-dev%2Fkeka-mcp%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=keka&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Arajuprasad-dev%2Fkeka-mcp%22%5D%7D)

Clicking a button opens that editor and asks you to add the Keka server. Your Keka login is not in the button. The first tool call asks you to paste one curl command, or you can put that command in the config as shown below.

## Connect Keka

1. Sign in at `https://company.keka.com`.
2. Open DevTools (`F12`, or `Cmd+Option+I` on Mac).
3. Open **Network**, enable **Fetch/XHR**, and refresh.
4. Right-click a request whose path starts with `/k/default/api/me/`.
5. Choose **Copy**, then **Copy as cURL**.

Paste that command when the client asks, or set it as `KEKA_CURL`. The company comes from the URL. The access token comes from the `Authorization` header. The cookie is kept when the command includes one.

`document.cookie` is not enough. Keka authorizes dashboard calls with the bearer token on that request.

The token stays on your machine. Do not commit it, and do not paste it into a public issue. It expires. When Keka rejects it, paste a fresh curl or update `KEKA_CURL`.

Clients that support MCP elicitation show a paste box on the first tool call and remember it in `data/session.json` next to the installed package. Every other client should set one of these environments:

| Variable | Required | What to put |
| --- | --- | --- |
| `KEKA_CURL` | One of these | The full curl command from the steps above. |
| `KEKA_COMPANY` | With `KEKA_TOKEN` | The label in `https://company.keka.com`. |
| `KEKA_TOKEN` | With `KEKA_COMPANY` | The value after `Authorization: Bearer`. |
| `KEKA_COOKIE` | No | The `Cookie` header from the same request. |

`KEKA_SUBDOMAIN` is accepted as another name for `KEKA_COMPANY`. `KEKA_BEARER` is accepted as another name for `KEKA_TOKEN`.

## Cursor

Use the button above, or add this to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "keka": {
      "command": "npx",
      "args": ["-y", "github:rajuprasad-dev/keka-mcp"]
    }
  }
}
```

To skip the paste prompt, add the curl in `env`:

```json
{
  "mcpServers": {
    "keka": {
      "command": "npx",
      "args": ["-y", "github:rajuprasad-dev/keka-mcp"],
      "env": {
        "KEKA_CURL": "paste the curl command here"
      }
    }
  }
}
```

## VS Code

Use the badge above. VS Code writes the server into your user or workspace MCP config. The same JSON as Cursor works in `.vscode/mcp.json` under a `servers` key:

```json
{
  "servers": {
    "keka": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:rajuprasad-dev/keka-mcp"]
    }
  }
}
```

From a terminal:

```bash
code --add-mcp '{"name":"keka","command":"npx","args":["-y","github:rajuprasad-dev/keka-mcp"]}'
```

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Restart Claude after saving.

```json
{
  "mcpServers": {
    "keka": {
      "command": "npx",
      "args": ["-y", "github:rajuprasad-dev/keka-mcp"],
      "env": {
        "KEKA_CURL": "paste the curl command here"
      }
    }
  }
}
```

On Windows, Claude often cannot spawn `npx` directly:

```json
{
  "mcpServers": {
    "keka": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "github:rajuprasad-dev/keka-mcp"],
      "env": {
        "KEKA_CURL": "paste the curl command here"
      }
    }
  }
}
```

## Claude Code

```bash
claude mcp add keka -- npx -y github:rajuprasad-dev/keka-mcp
```

With the curl stored in the client config:

```bash
claude mcp add keka -e KEKA_CURL='paste the curl command here' -- npx -y github:rajuprasad-dev/keka-mcp
```

## Windsurf, Cline, and Continue

These use the same `mcpServers` object as Cursor.

- Windsurf: `~/.codeium/windsurf/mcp_config.json`
- Cline: MCP settings in the extension
- Continue: `~/.continue/config.yaml` or the MCP block in `config.json`

```json
{
  "mcpServers": {
    "keka": {
      "command": "npx",
      "args": ["-y", "github:rajuprasad-dev/keka-mcp"],
      "env": {
        "KEKA_CURL": "paste the curl command here"
      }
    }
  }
}
```

## Zed

```json
{
  "context_servers": {
    "keka": {
      "command": {
        "path": "npx",
        "args": ["-y", "github:rajuprasad-dev/keka-mcp"],
        "env": {
          "KEKA_CURL": "paste the curl command here"
        }
      }
    }
  }
}
```

## Codex CLI

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.keka]
command = "npx"
args = ["-y", "github:rajuprasad-dev/keka-mcp"]

[mcp_servers.keka.env]
KEKA_CURL = "paste the curl command here"
```

## Gemini CLI

Add the Cursor `mcpServers` block to `~/.gemini/settings.json`.

## Goose

```bash
goose configure
```

Choose to add an extension command:

```text
npx -y github:rajuprasad-dev/keka-mcp
```

Set `KEKA_CURL` in the extension environment.

## What you can ask

These tools read the signed-in employee dashboard. A module your company has turned off returns Keka's own error for that call. Nothing here clocks you in, submits leave, or approves a request.

| Tool | What it reads |
| --- | --- |
| `get_profile_info` | Profile header. |
| `get_profile_completion` | Whether the profile is complete. |
| `get_id_card` | ID card. |
| `get_timeline` | Timeline events. |
| `get_preferences` | Account preferences. |
| `get_probation_policy` | Probation policy. |
| `get_exit_status` | Resignation and exit details. |
| `get_leave_balance` | Remaining time off. Optional `forDate` (`YYYY-MM-DD`). |
| `get_leave_requests` | Leave requests on one date. Optional `forDate`. |
| `get_leave_transactions` | Leave transactions. |
| `get_leave_stats` | Leave stats on one date. Optional `forDate`. |
| `get_holidays` | Holiday list. |
| `get_weekly_off_policy` | Weekly off policy. |
| `get_leave_plan_status` | Whether a leave plan is assigned. |
| `get_pending_leave_encashment` | Pending leave encashment. |
| `get_attendance_status` | Today's punch, shift, and summaries. Optional `fromDate` and `toDate`. |
| `get_attendance_calendar` | Attendance calendar. Optional `fromDate` and `toDate`. |
| `get_attendance_summary` | Current attendance summary. |
| `get_shift_details` | Shift and weekly off. |
| `get_shift_policy` | Shift policy. |
| `get_last_week_attendance` | Last week's stats. |
| `get_attendance_requests` | Regularization requests. |
| `get_adjustment_requests` | Adjustment requests. |
| `get_partial_day_requests` | Partial-day requests. |
| `get_remote_work_requests` | Remote clock-in and work-from-home requests. |
| `get_attendance_policy` | Capture scheme and tracking policy. |
| `get_pending_attendance_count` | Pending attendance request count. |
| `get_current_shifts` | Current shift schedules. |
| `get_expense_policy` | Expense policy. |
| `get_pending_expenses` | Pending bills. |
| `get_expense_claims` | Pending and past claims. |
| `get_advance_requests` | Pending and unclaimed advances. |
| `get_timesheet_profile` | Timesheet profile. |
| `get_timesheets` | Timesheet summary. |
| `get_timesheets_due` | Timesheets due. |
| `get_rejected_timesheets` | Rejected timesheets. |
| `get_timesheet_policy` | Timesheet policy. |
| `get_my_assets` | Assigned assets. |
| `get_asset_requests` | Asset requests. |
| `get_payroll_preferences` | Payroll preferences. |
| `get_pending_approvals` | Inbox items waiting on you. |
| `get_feedback_settings` | Feedback settings. |
| `get_praise_badges` | Praise badges. |

## Develop

```bash
git clone https://github.com/rajuprasad-dev/keka-mcp.git
cd keka-mcp
npm install
node index.js
```

Point your client at `node` and the absolute path of `index.js` while you are changing it. `npx github:rajuprasad-dev/keka-mcp` always runs the published `main` branch.

## License

[MIT](LICENSE)
