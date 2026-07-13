# Issue Tracker: GitHub

Issues and PRDs live in the personal GitHub repository `the-prairie/goDiesel`.

Use the `gh` CLI with `--repo the-prairie/goDiesel` for all operations.
Do not infer or substitute another GitHub owner or repository.

## Conventions

- Create: `gh issue create --repo the-prairie/goDiesel`
- Read: `gh issue view <number> --repo the-prairie/goDiesel --comments`
- List: `gh issue list --repo the-prairie/goDiesel`
- Comment: `gh issue comment <number> --repo the-prairie/goDiesel`
- Label: `gh issue edit <number> --repo the-prairie/goDiesel --add-label "<label>"`
- Close: `gh issue close <number> --repo the-prairie/goDiesel`

## Pull Requests

Pull requests are not a request or triage surface.

Implementation PRs remain implementation artifacts and should not enter the issue triage queue.

## Publishing

When a skill says to publish to the issue tracker, create a GitHub issue in `the-prairie/goDiesel`.

When a skill says to fetch a ticket, read the corresponding GitHub issue and its comments from `the-prairie/goDiesel`.
