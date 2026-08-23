from pathlib import Path


ROOT = Path(__file__).parent
PRODUCTION_DEPLOY_COMMAND = (
    "npx wrangler pages deploy dist --project-name=godiesel --branch=production"
)


def test_canonical_pages_deploy_targets_the_production_branch():
    readme_lines = (ROOT / "README.md").read_text(encoding="utf-8").splitlines()
    packaging_lines = (ROOT / "make-dist.sh").read_text(encoding="utf-8").splitlines()

    documented_commands = [
        line.strip()
        for line in readme_lines
        if line.strip().startswith("npx wrangler pages deploy dist")
    ]
    printed_commands = [
        line.strip()
        for line in packaging_lines
        if "Deploy with: npx wrangler pages deploy dist" in line
    ]

    assert documented_commands == [PRODUCTION_DEPLOY_COMMAND]
    assert len(printed_commands) == 1
    assert PRODUCTION_DEPLOY_COMMAND in printed_commands[0]
