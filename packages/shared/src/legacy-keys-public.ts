// Public-side exports of the v1 mobile-app legacy keypair. Safe to
// barrel-export — these values are what /api/.well-known/jwks.json
// already serves to the internet.

export const LEGACY_KID = "legacy-2022";

export const LEGACY_RSA_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtHcJWchdIm8I3ApCr9O4
cFGOWqV5NcLqLJufD1FhENOv4Tw03dq9Xa8ev4sgBY5ONYaLjYEnY4xIqA137oJO
hUcgM4/fqQt9OXwhKyQGyM1e/o/WE1UvNlqy7mTbfaYkhgEqCs5rTrGVvXw/L1ri
YAM+JQwTlYWkQUTJpmgaYz7Ky6rJs66INXMTDW+XznSTUwdvMUtbQgqZqeryoL+7
ZCkkgJQAHC5D4JwTL3NmdbKhDlpTjN476lrSS6gds9h/Nk7vfI4cVZhUwP0xcPCB
PovwIezW+psMag2u9CYfl36SJ1Q6JiUv+p+OarO6FWPKGL7NpQ2pnBACp2I8T9ng
XQIDAQAB
-----END PUBLIC KEY-----
`;
