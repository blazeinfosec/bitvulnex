export type Role =
  | "user"
  | "support"
  | "compliance"
  | "admin"
  | "treasury";

export type KycTier = 0 | 1 | 2 | 3;

export type UserClaims = {
  sub: string;
  email: string;
  role: Role;
  kycTier: KycTier;
};
