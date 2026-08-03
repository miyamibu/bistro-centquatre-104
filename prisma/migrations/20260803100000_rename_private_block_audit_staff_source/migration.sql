-- Replace the historical shared-Basic audit label with the authenticated staff-user label.
ALTER TYPE "PrivateBlockAuditSource"
  RENAME VALUE 'ADMIN_SHARED_BASIC' TO 'ADMIN_USER';
