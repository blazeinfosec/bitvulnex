// Private side of the legacy v1 mobile-app RSA keypair. NOT
// re-exported from the package barrel — consumers must import from
// the deep path `@bvbe/shared/legacy-keys` to pull this in. Today no
// app code references the private key (the v1 issuer signs HMAC); it
// is retained so future legacy-flow tooling can mint test RS256
// tokens against the lab without regenerating the pair.

export { LEGACY_KID, LEGACY_RSA_PUBLIC_PEM } from "./legacy-keys-public";

export const LEGACY_RSA_PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC0dwlZyF0ibwjc
CkKv07hwUY5apXk1wuosm58PUWEQ06/hPDTd2r1drx6/iyAFjk41houNgSdjjEio
DXfugk6FRyAzj9+pC305fCErJAbIzV7+j9YTVS82WrLuZNt9piSGASoKzmtOsZW9
fD8vWuJgAz4lDBOVhaRBRMmmaBpjPsrLqsmzrog1cxMNb5fOdJNTB28xS1tCCpmp
6vKgv7tkKSSAlAAcLkPgnBMvc2Z1sqEOWlOM3jvqWtJLqB2z2H82Tu98jhxVmFTA
/TFw8IE+i/Ah7Nb6mwxqDa70Jh+XfpInVDomJS/6n45qs7oVY8oYvs2lDamcEAKn
YjxP2eBdAgMBAAECggEABHoojVBDKUHJHeZo7veeeDY5xSYc+qMOOr2V+w65N648
yzvPvEpQj49dlgHJBqztY/a60G+qGcDm+OOz/ELs2PHMYCMbY38BZBNK4l5c3GSl
95mmGr7ZXUHvoFT4Z2a0uhizducAnV2ar1kIBfAoChrtKC+jbmlNS4DooibWiBbs
dD9483e3h0mn6d6nzsb1X1AUN7abnI/FmtBw3fmQQxAYNzjYIdQQRheAc1LuM62t
rG0/dfKY+c1fDYv91KL+fYV1yydIZmXEBbzQxkkSy6Rp3nvN9Sv075eEkOB4k3P1
qe6DK+K+S+8AS/pO6Z9EnsKTf/Rnumn5il04ql8rOQKBgQDi/riT55XakGIWYOKB
mLapJFZAcKXUqRH/Ryv9vAzy+EuhTWFoIgQFxhW1Wovt/R7bRs/IAFEsIGv8VP+S
XYz8ZuzqN0ewFNivXTVLmrqJs2ww+g/+V/iQS6Hu/Ho70NBpkeG9WNiIN9+jPBgB
7b1Q+Dm1CYpNcng03qxPuRKO2QKBgQDLhkNHS/Vbksyl/nQTqXb8hZyrhlNqx++J
YXdNNaomx4YIFxH/kKSXU6zRI3Nwcz4oCaf6y7fwfDddOcOodUz/942whMEvkSqK
bQ55ApHnoiGYTt6nLHFermO/YWf74LuMsxKO5gGWtxdEV1uq8KinBOi4iDbZnNqB
CiENBaYzJQKBgQDhujGsiwge36Na4597BnTmQEcxL5QIpNRLyee6G4249CapUbzC
g8kCQNgHjvJFiIdtwL4RAhe2TMt1ksTPNQ5lVKjVxIEaXbCYupSsCULkejLlhVXw
NGTugPeYIyQeZWlLAhG8bCRvWTigJ7sr99FiOmWQXNtWZrWYxbIOWVlWCQKBgBF7
4T+4uMU7ITWJXHNr9XrQB5t8mKHttxg4NUV+vLVEIrGDOdqYlGsjlw8IWpxoagiK
e9HBunWAVkk98x7/pLPAkn19ihMKB3uIztt6awpZFUW+UMZPvRWDKbKBLaunrLTz
lT6NZ8mIxQjr8EYJEpP2if+ARCYBoYvAUQKLX7G5AoGAc7Hm9QszVDzHYoZ/eqG2
Xt4mrSv7KXSP6LOzv7zWCXdP6zmNf9/g29EBi31ZYylYRFqls3ScW6UneJ3iCQaf
zHFIEiCDM/UxNAh7xogn4eYSt8eMIEIrI/mr/vreQEtWA4TuHjzqlmN502Fzgp+e
8xsozkSo7criNFgyfyAqXvs=
-----END PRIVATE KEY-----
`;
