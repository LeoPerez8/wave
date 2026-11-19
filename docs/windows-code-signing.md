# Windows code signing

The repository owner applies to SignPath Foundation after Wave qualifies under its OSS terms,
including an eligible licence and a published Windows release. The owner sets up trusted
GitHub builds, the signing roles and MFA, and the public code signing and privacy disclosures.
Confirm the bundled components and installer meet the terms during onboarding. The signing
key stays in SignPath's HSM. [SignPath Foundation terms](https://signpath.org/terms)

In SignPath, link the GitHub.com trusted build system to the Wave project. Restrict requests
to this repository's release workflow, trusted release refs and GitHub-hosted runners, and
require manual approval of both requests. On a push to `main`, GitHub's run SHA can differ
from Wave's release source because the version bot adds a commit. Review the gate's recorded
source and confirm this flow with SignPath before enabling the policy.
[SignPath's GitHub integration](https://docs.signpath.io/trusted-build-systems/github)

Create two ZIP-root artifact configurations for Authenticode with timestamping. Use
`wave-exe` for the single `Wave.exe` PE at the ZIP root and `wave-nsis` for the single
`wave-*-win-x64.exe` PE at the ZIP root. Keep the same path and filename in each returned
ZIP. Enforce the Wave product name and matching Windows product version as required by
SignPath. Confirm the metadata on both files when setting up the rules.
[SignPath artifact configuration](https://docs.signpath.io/artifact-configuration/reference)

Set the GitHub Actions variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`,
`SIGNPATH_SIGNING_POLICY_SLUG`, and `SIGNPATH_CERTIFICATE_SHA256`. The last value is the
64-character SHA-256 fingerprint of the expected leaf signing certificate. Put the submitter's
`SIGNPATH_API_TOKEN` secret only in the release Environments that sign Windows builds
(`ti` for pushes to `main`, `main` for version tags). The `main` Environment also guards the
Windows signing job, so a tag release may need a second GitHub approval before publication.

Set the repository variable `WAVE_WINDOWS_SIGNPATH` to `on` after setup. An unset value
or `off` keeps ti Windows installers unsigned. Stable desktop releases require signing.
Approve both SignPath requests on the first authorized release and verify the published
installer and installed `Wave.exe` on clean Windows. Check that the blockmap covers the signed
installer and that an update from the prior ti version installs. With signing enabled, a
failed request or verification stops the release. Update the certificate fingerprint with
the signing policy when the signer certificate changes.
