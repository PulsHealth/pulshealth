#!/usr/bin/env python3
"""Run iOS suites on an owned, booted simulator; preserve logs and result bundles."""

import argparse
import json
import subprocess
import sys
import uuid
from pathlib import Path

from dev_evidence import IOS_INPUTS, fingerprint, git, state_dir, timestamp, write_json

ROOT = Path(__file__).resolve().parents[1]


def runtime_id(version):
    return "com.apple.CoreSimulator.SimRuntime.iOS-" + version.replace(".", "-")


def available_runtime(runtimes, version):
    # Match the version value as well: Apple sometimes omits trailing .0 in IDs.
    wanted = tuple(map(int, version.split(".")))
    for runtime in runtimes:
        actual = tuple(map(int, runtime.get("version", "0").split(".")))
        if runtime.get("isAvailable") and actual[:len(wanted)] == wanted:
            return runtime["identifier"]
    return None


class Runner:
    def __init__(self, root, artifacts):
        self.root, self.artifacts = root, artifacts
        self.device = None
        self.owned_devices = set()
        self.setup_errors = []
        self.cleanup_errors = []

    def command(self, args, name, cwd=None, timeout=180):
        print(name, flush=True)
        with (self.artifacts / (name + ".log")).open("w") as log:
            result = subprocess.run(args, cwd=cwd or self.root, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
        if result.returncode:
            raise RuntimeError(f"{name} failed (exit {result.returncode}); inspect {name}.log")

    def remove_device(self):
        # Cleanup must not replace a boot/test error or prevent the setup retry.
        # Try deletion even if shutdown hangs; retain IDs that could not be removed.
        device, self.device = self.device, None
        if not device:
            return
        for operation in ("shutdown", "delete"):
            command = ["xcrun", "simctl", operation, device]
            try:
                result = subprocess.run(command, capture_output=True, text=True, timeout=30)
                if result.returncode:
                    self.cleanup_errors.append(f"{operation} {device}: exit {result.returncode}")
                elif operation == "delete":
                    self.owned_devices.discard(device)
            except (OSError, subprocess.SubprocessError) as error:
                self.cleanup_errors.append(f"{operation} {device}: {error}")

    def prepare(self, runtime):
        # Retry only setup, before any test executes. Never reset shared devices
        # or restart CoreSimulator globally, which would disrupt other sessions.
        for attempt in range(2):
            try:
                self.device = subprocess.check_output([
                    "xcrun", "simctl", "create", "PulsHealth-" + uuid.uuid4().hex[:10],
                    "com.apple.CoreSimulator.SimDeviceType.iPhone-17", runtime,
                ], text=True, timeout=60).strip()
                self.owned_devices.add(self.device)
                self.command(["xcrun", "simctl", "boot", self.device], f"boot-{attempt}")
                self.command(["xcrun", "simctl", "bootstatus", self.device, "-b"], f"bootstatus-{attempt}")
                return
            except (RuntimeError, subprocess.SubprocessError) as error:
                self.setup_errors.append(str(error))
                self.remove_device()
                if attempt:
                    raise
                print("Simulator setup failed; trying one fresh owned device", flush=True)

    def test(self, component, signed=False, only=None):
        directory = "PulsHealthSync" if component == "package" else "PulsHealth"
        if component == "app":
            self.command(["xcodegen", "generate"], "xcodegen", self.root / directory)
        command = ["xcodebuild", "test", "-scheme", directory,
                   "-destination", f"platform=iOS Simulator,id={self.device}",
                   "-destination-timeout", "60", "-parallel-testing-enabled", "NO",
                   "-derivedDataPath", str(self.artifacts / (component + "-derived")),
                   "-resultBundlePath", str(self.artifacts / (component + ".xcresult"))]
        if signed:
            command += ["CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-", "CODE_SIGN_STYLE=Manual", "DEVELOPMENT_TEAM="]
        else:
            command += ["CODE_SIGNING_ALLOWED=NO"]
        if only:
            command += ["-only-testing:" + only]
        self.command(command, component + "-tests", self.root / directory, timeout=1200)
        summary = json.loads(subprocess.check_output([
            "xcrun", "xcresulttool", "get", "test-results", "summary", "--path",
            str(self.artifacts / (component + ".xcresult")),
        ], timeout=60))
        write_json(self.artifacts / (component + "-summary.json"), summary)
        require_executed_tests(summary, focused=bool(only))
        return {key: summary.get(key, 0) for key in ("passedTests", "failedTests", "skippedTests", "totalTestCount")}



def require_executed_tests(summary, focused=False):
    if summary.get("passedTests", 0) < 1 or summary.get("failedTests", 0):
        raise RuntimeError("Test result has failures or no passing tests")
    if focused and summary.get("skippedTests", 0):
        raise RuntimeError("Focused acceptance was skipped; it is not a pass")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ios", default="27.0", help="Pinned runtime version; select Xcode with DEVELOPER_DIR")
    parser.add_argument("--suite", choices=["all", "package", "app"], default="all")
    parser.add_argument("--download-runtime", action="store_true", help="Allow downloading the pinned runtime (CI)")
    parser.add_argument("--signed", action="store_true", help="Ad-hoc signed simulator for Keychain acceptance")
    parser.add_argument("--only-testing", help="Focused test identifier, requires --suite app or package")
    parser.add_argument("--artifacts", type=Path)
    args = parser.parse_args()
    if args.only_testing and args.suite == "all":
        parser.error("Choose one suite for focused tests")
    artifacts = (args.artifacts or state_dir(ROOT) / "ios" / timestamp().replace(":", "-")).resolve()
    artifacts.mkdir(parents=True, exist_ok=False)
    runner = Runner(ROOT, artifacts)
    inputs = fingerprint(ROOT, IOS_INPUTS)
    receipt = {"source_sha": git(ROOT, "rev-parse", "HEAD"), "inputs_sha256": inputs,
               "started_at": timestamp(), "status": "failed", "runtime_version": args.ios,
               "suite": args.suite, "only_testing": args.only_testing,
               "method": "signed-simulator" if args.signed else "automated", "signed": args.signed, "results": {}}
    try:
        runner.command(["xcodebuild", "-version"], "xcode-version")
        runner.command(["xcrun", "simctl", "list", "-j"], "simulator-inventory")
        runtimes = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "runtimes", "-j"]))["runtimes"]
        runtime = available_runtime(runtimes, args.ios)
        if not runtime and args.download_runtime:
            runner.command(["xcodebuild", "-downloadPlatform", "iOS", "-buildVersion", args.ios], "runtime-download", timeout=900)
            runtimes = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "runtimes", "-j"]))["runtimes"]
            runtime = available_runtime(runtimes, args.ios)
        if not runtime:
            raise RuntimeError(f"iOS {args.ios} runtime unavailable; install it or use --download-runtime")
        runner.prepare(runtime)
        for suite in (["package", "app"] if args.suite == "all" else [args.suite]):
            receipt["results"][suite] = runner.test(suite, args.signed, args.only_testing)
        if fingerprint(ROOT, IOS_INPUTS) != inputs:
            raise RuntimeError("Source inputs changed during tests; results are not candidate evidence")
        receipt["status"] = "passed"
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        receipt["error"] = str(error)
        print(error, file=sys.stderr)
    finally:
        runner.remove_device()
        receipt["setup_errors"] = runner.setup_errors
        receipt["cleanup_errors"] = runner.cleanup_errors
        receipt["leftover_owned_devices"] = sorted(runner.owned_devices)
        receipt["finished_at"] = timestamp()
        write_json(artifacts / "receipt.json", receipt)
        print(f"iOS evidence: {artifacts}")
    return int(receipt["status"] != "passed")


if __name__ == "__main__":
    sys.exit(main())
