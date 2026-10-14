"""Guard the contract between scripts/run_toll.py and the Weekly Health Check.

.github/workflows/health-check.yml does not import run_toll.py; it scans the
source for lines containing 'ANTHROPIC_MODEL = ' / 'ANTHROPIC_SEARCH_TOOL = '
and takes line.split('"')[1]. When ANTHROPIC_MODEL became
`ANTHROPIC_MODELS[0]` (no quotes) that raised IndexError and the health check
failed every week before making any API call. This test runs the same parse.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUN_TOLL = ROOT / "scripts" / "run_toll.py"


def _workflow_parse(content: str):
    """Exact logic from the 'Validate Anthropic API' step."""
    model = tool = None
    for line in content.split("\n"):
        if "ANTHROPIC_MODEL = " in line:
            model = line.split('"')[1]
        if "ANTHROPIC_SEARCH_TOOL = " in line:
            tool = line.split('"')[1]
    return model, tool


def _load_run_toll():
    spec = importlib.util.spec_from_file_location("run_toll_hc", RUN_TOLL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_workflow_parse_does_not_raise_and_finds_both():
    model, tool = _workflow_parse(RUN_TOLL.read_text())
    assert model and tool


def test_workflow_parse_matches_module_values():
    model, tool = _workflow_parse(RUN_TOLL.read_text())
    mod = _load_run_toll()
    assert model == mod.ANTHROPIC_MODEL
    assert tool == mod.ANTHROPIC_SEARCH_TOOL


def test_health_check_tests_the_collectors_first_model():
    mod = _load_run_toll()
    assert mod.ANTHROPIC_MODELS[0] == mod.ANTHROPIC_MODEL
    assert len(set(mod.ANTHROPIC_MODELS)) == len(mod.ANTHROPIC_MODELS)
