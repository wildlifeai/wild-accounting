# Wild Accounting

Wildlife.ai's budgeting and accounting tools. The main one is the **Funding Cockpit**: a
dashboard that puts every funding source's budget next to what Xero says was actually spent and
received, and shows how long the money lasts.

## Open the Funding Cockpit

**<https://script.google.com/a/macros/wildlife.ai/s/AKfycbxCjtIS-xnIdySCtFF7vibrW0qhhnMcnzFs0GCPK0SXrzFzV5-WZtNnpkyTWfbLdAqs/exec>**

Sign in with your `wildlife.ai` Google account and bookmark it; the link does not change. You see
the projects you have access to. **To get access, or access to more projects, ask the GM.**

## What do you want to do?

| I want to | Where |
|---|---|
| See where the money is: budget, secured funding, spend and runway | The cockpit's **Overview**, explained in the [user guide](docs/USER_GUIDE.md) |
| Track a project's funding sources quarter by quarter, as actual and forecast or as a timeline | **Project tracking**, see [tracking and forecasting](docs/USER_GUIDE.md#tracking-and-forecasting-quarterly) |
| Change a forecast | The funding source's own `Forecast` tab, see [the user guide](docs/USER_GUIDE.md#tracking-and-forecasting-quarterly) |
| Start a budget for a new grant or application | Download the [budget template](docs/Budget_sheet_template.xlsx), then follow the [budget sheet guide](docs/BUDGET_SHEET_TEMPLATE.md) |
| Understand a warning on the Health tab | [Health checks](docs/HEALTH_CHECKS.md): what each one means and what to do |
| Code a transaction in Xero so the cockpit counts it | [Coding transactions in Xero](docs/USER_GUIDE.md#coding-transactions-in-xero) |

## Why it exists

Wildlife.ai runs on restricted funding, reported by funder, project and milestone, and no tool we
can buy tracks all of those at once: Xero has room for only two tracking categories and reports by
account. So budgets live in Google Sheets and actuals in Xero, and the cockpit joins them. The full
reasoning, who it serves and what it still cannot do are in [the design](docs/DESIGN.md).

## Documentation

| For | Read |
|---|---|
| Anyone using the cockpit | [User guide](docs/USER_GUIDE.md) |
| Anyone writing a budget | [Budget sheet guide](docs/BUDGET_SHEET_TEMPLATE.md) and the [template](docs/Budget_sheet_template.xlsx) |
| Anyone reading a warning | [Health checks](docs/HEALTH_CHECKS.md) |
| The board, and anyone deciding what to build next | [Design: why, requirements, open questions, decisions](docs/DESIGN.md) |
| Developers changing the code | [`AGENTS.md`](AGENTS.md) for setup and deploying, then [`SKILL.md`](.agents/skills/SKILL.md) for the rules |

This repository is public. It holds how the system works, never the figures: real budgets and
funder terms live in the Budgets Drive and in `wildlife-ai-management`.
