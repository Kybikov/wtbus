UPDATE trips SET status='in_progress' WHERE status='in_progress_delayed';
DELETE FROM workflow_statuses WHERE entity_type='trips' AND key='in_progress_delayed';
