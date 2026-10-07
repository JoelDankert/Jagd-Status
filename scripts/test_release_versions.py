import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from release_versions import ReleaseError, ReleaseManager


class ReleaseManagerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "backend").mkdir()
        (self.root / "frontend" / "dist").mkdir(parents=True)
        (self.root / "backend" / "server.js").write_text("old-server")
        (self.root / "frontend" / "dist" / "index.html").write_text("old-ui")
        self.service_calls = []
        self.health = True
        self.manager = ReleaseManager(
            self.root, uid_getter=lambda: 0,
            service_runner=lambda action: self.service_calls.append(action),
            health_checker=lambda: self.health,
            now=lambda: datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
        )

    def tearDown(self): self.temp.cleanup()

    def test_root_guard_covers_all_commands(self):
        blocked = ReleaseManager(self.root, uid_getter=lambda: 1000)
        for call in (blocked.list, lambda: blocked.show("v20260102T030405Z-1234abcd"),
                     blocked.snapshot, lambda: blocked.revert("v20260102T030405Z-1234abcd")):
            with self.assertRaises(PermissionError): call()

    def test_snapshot_list_and_show(self):
        snap = self.manager.snapshot()
        self.assertEqual(self.manager.list()[0]["version"], snap["version"])
        shown = self.manager.show(snap["version"])
        self.assertEqual(shown["assets"][0]["files"][0]["path"], "backend/server.js")
        self.assertEqual((self.root / "data" / "versions").stat().st_mode & 0o777, 0o700)
        with self.assertRaises(ReleaseError): self.manager.show("../../data")

    def test_revert_and_safety_snapshot(self):
        version = self.manager.snapshot()["version"]
        (self.root / "backend" / "server.js").write_text("new-server")
        (self.root / "frontend" / "dist" / "index.html").write_text("new-ui")
        result = self.manager.revert(version)
        self.assertEqual((self.root / "backend" / "server.js").read_text(), "old-server")
        self.assertEqual((self.root / "frontend" / "dist" / "index.html").read_text(), "old-ui")
        safety = self.manager.show(result["safety_snapshot"]["version"])
        safety_file = self.root / "data" / "versions" / safety["version"] / "app" / "backend" / "server.js"
        self.assertEqual(safety_file.read_text(), "new-server")
        self.assertEqual(self.service_calls, ["restart"])

    def test_failed_health_rolls_back(self):
        version = self.manager.snapshot()["version"]
        (self.root / "backend" / "server.js").write_text("current")
        self.health = False
        with self.assertRaisesRegex(ReleaseError, "wiederhergestellt"):
            self.manager.revert(version)
        self.assertEqual((self.root / "backend" / "server.js").read_text(), "current")
        self.assertEqual(self.service_calls, ["restart", "restart"])


if __name__ == "__main__": unittest.main()
