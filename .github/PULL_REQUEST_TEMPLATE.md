## What and why

<!-- Problem and resulting behavior, in one or two sentences. Link the issue for work larger than a bug fix. -->

## Validation

<!-- Checks actually run and their results. Mention AI review for behavior changes and any remaining device/live acceptance gates. Do not call skipped checks passing. -->

## Checklist

- [ ] Commits are signed off (`git commit -s`); preserve the sign-off when squash merging.
- [ ] Applicable checks pass; `scripts/check-public-tree.sh` passes.
- [ ] Documentation matches any behavior change.

<!-- Complete only the applicable items below; delete the others. -->

- [ ] Wire-format change: client + receiver + protocol schemas/fixtures agree; required migrations included; server ships first (see CONTRIBUTING.md).
- [ ] Schema change: new numbered migration; applied files unchanged; deployment order stated.
- [ ] Generated inputs changed: regenerate the outputs (including XcodeGen for app file/project changes).
- [ ] Release/deployment work: exact source revision/artifacts and acceptance evidence recorded; remaining gates stated.
