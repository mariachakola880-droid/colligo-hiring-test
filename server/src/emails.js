/** One canonical form for every stored email (agents and customers). The DB enforces it too. */
export const normalizeEmail = (email) => String(email).trim().toLowerCase();
