-- The runtime role updates token rows in place; it never hard-deletes them.
DROP POLICY IF EXISTS "bistro_rt_reservationlinelinktoken_delete"
ON public."ReservationLineLinkToken";
