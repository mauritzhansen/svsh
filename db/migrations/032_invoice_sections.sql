-- Invoices used to be a flat list of lines in date order, which on a busy month
-- ran to twenty-odd rows with no shape: livery, lessons and extras interleaved.
--
-- This records which heading a line belongs under, so the PDF can group it:
--   'Livery — Bella'     the horse's livery and its fixed monthly charges
--   'Group Lesson 75'    a lesson type, with the rider's dates collapsed on one row
--   'Additional costs'   one-off expenses, discounts, arena fees
--
-- NULL on older invoices, which keep rendering as the flat list they were sent
-- as — an invoice already with a customer must not change shape afterwards.

ALTER TABLE invoice_lines ADD COLUMN section TEXT;
