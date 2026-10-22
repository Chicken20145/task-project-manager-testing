ALTER TABLE tasks ADD COLUMN due_at TEXT CHECK(due_at IS NULL OR
    (length(due_at)=20 AND substr(due_at,1,4) BETWEEN '0001' AND '9999' AND
     substr(due_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',due_at,'+0 days') IS due_at));
UPDATE tasks SET due_at=due_date||'T16:59:59Z' WHERE due_date IS NOT NULL;
CREATE INDEX tasks_deadline ON tasks(due_at,project_id);
