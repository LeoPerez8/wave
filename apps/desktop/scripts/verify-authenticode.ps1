param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'
$expected = $env:SIGNPATH_CERTIFICATE_SHA256
if ($expected -notmatch '^[0-9a-fA-F]{64}$') {
    throw 'Configure SIGNPATH_CERTIFICATE_SHA256 with the expected signer certificate hash.'
}
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($signature.Status -ne 'Valid' -or $signature.SignatureType -ne 'Authenticode' -or
    -not $signature.TimeStamperCertificate) {
    throw "Expected a valid timestamped Authenticode signature on $Path (status $($signature.Status))."
}
$actual = $signature.SignerCertificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256)
if ($actual -ne $expected) {
    throw "Unexpected Authenticode signer on $Path."
}
