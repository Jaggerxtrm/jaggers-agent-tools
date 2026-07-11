"""PACK.json is ignored and removed by v2 layout migration."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import layout_migrator as lm  # noqa: E402


def test_pack_json_is_removed_after_migration() -> None:
    with TemporaryDirectory() as directory:
        root = Path(directory)
        pack = root / ".xtrm" / "skills" / "pack"
        service = pack / "svc"
        service.mkdir(parents=True)
        (service / "SKILL.md").write_text("# svc\n", encoding="utf-8")
        (pack / "PACK.json").write_text(json.dumps({"name": "pack"}), encoding="utf-8")
        (pack / "service-registry.json").write_text(json.dumps({"services": {}}), encoding="utf-8")

        result = lm.migrate_pack(root, pack, "repo")

        assert result["status"] == "ok"
        assert not (pack / "PACK.json").exists()
