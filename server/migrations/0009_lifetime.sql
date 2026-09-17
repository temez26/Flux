-- How long an uploaded transfer lasts once its upload completes. Until then it is kept while the
-- upload is still active, so a short lifetime can't run out before the files have arrived. Null
-- where there is nothing to upload (text, collections, files served from a device): those count
-- from creation.
ALTER TABLE transfers ADD COLUMN lifetime INTEGER;
