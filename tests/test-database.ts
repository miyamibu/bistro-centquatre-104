import { createTestPrismaClient, getDestructiveTestDbAccess } from "./utils/assert-test-database";

export { createTestPrismaClient };

export const destructiveTestDbAccess = getDestructiveTestDbAccess();
