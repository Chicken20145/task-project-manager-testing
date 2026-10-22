"""Pure deterministic SQLite seed fixtures for task manager."""

TITLES = [
    "Thiết kế giao diện trang đăng nhập",
    "Tích hợp API xác thực OAuth2",
    "Xây dựng module truy vấn task",
    "Viết unit test cho bộ lọc",
    "Sửa lỗi phân trang danh sách",
    "Tối ưu hiệu năng truy vấn database",
    "Cập nhật tài liệu API",
    "Kiểm thử bảo mật đầu vào",
    "Đánh giá code review",
    "Triển khai CI/CD pipeline",
]


def _build_users() -> list[dict]:
    return [
        {
            "id": 1,
            "username": "nguyen.van.a",
            "display_name": "Nguyen Van A",
            "created_at": "2026-10-01T08:00:00Z",
        },
        {
            "id": 2,
            "username": "tran.thi.b",
            "display_name": "Tran Thi B",
            "created_at": "2026-10-01T08:00:00Z",
        },
        {
            "id": 3,
            "username": "le.van.c",
            "display_name": "Le Van C",
            "created_at": "2026-10-01T08:00:00Z",
        },
    ]


def generate_seed_data(profile: str = "demo") -> dict:
    """Generate fresh deterministic seed fixtures without db or network side effects."""
    if not isinstance(profile, str):
        raise TypeError(f"Profile must be a string, got {type(profile).__name__}")
    if profile not in ("demo", "load", "stress"):
        raise ValueError(f"Unknown profile: {profile}")

    users = _build_users()

    if profile == "demo":
        projects = [
            {
                "id": 10,
                "name": "Dự án Quản lý",
                "description": "Hệ thống quản lý",
                "owner_id": 1,
                "version": 1,
                "archived_at": None,
                "created_at": "2026-10-01T08:00:00Z",
                "updated_at": "2026-10-01T08:00:00Z",
            },
            {
                "id": 11,
                "name": "Dự án AI",
                "description": "Nghiên cứu",
                "owner_id": 1,
                "version": 1,
                "archived_at": None,
                "created_at": "2026-10-01T08:00:00Z",
                "updated_at": "2026-10-01T08:00:00Z",
            },
            {
                "id": 20,
                "name": "Dự án Cũ",
                "description": "Lưu trữ",
                "owner_id": 3,
                "version": 1,
                "archived_at": "2026-10-01T00:00:00Z",
                "created_at": "2026-10-01T08:00:00Z",
                "updated_at": "2026-10-01T08:00:00Z",
            },
        ]
        project_members = [
            {"project_id": 10, "user_id": 1, "joined_at": "2026-10-01T08:00:00Z"},
            {"project_id": 10, "user_id": 2, "joined_at": "2026-10-01T08:00:00Z"},
            {"project_id": 11, "user_id": 1, "joined_at": "2026-10-01T08:00:00Z"},
            {"project_id": 20, "user_id": 3, "joined_at": "2026-10-01T08:00:00Z"},
        ]
        tasks = []
        for i in range(1, 27):
            tasks.append({
                "id": 100 + i,
                "project_id": 10,
                "title": f"{TITLES[(i - 1) % len(TITLES)]} #{i}",
                "description": f"Mô tả chi tiết công việc số {i} trong dự án quản lý task",
                "assignee_id": None if i % 4 == 0 else (1 if i % 2 == 1 else 2),
                "due_date": ["2026-10-01", "2026-10-10", "2026-10-13", "2026-10-20", None][i % 5],
                "priority": ["low", "medium", "high"][i % 3],
                "status": ["todo", "doing", "done"][i % 3],
                "version": 1,
                "archived_at": "2026-10-11T10:00:00Z" if i == 26 else None,
                "created_at": "2026-10-01T08:00:00Z",
                "updated_at": "2026-10-02T08:00:00Z",
            })
        tasks.append({
            "id": 200,
            "project_id": 20,
            "title": "Nhiệm vụ cũ",
            "description": "Cũ",
            "assignee_id": 3,
            "due_date": "2026-09-30",
            "priority": "low",
            "status": "done",
            "version": 1,
            "archived_at": None,
            "created_at": "2026-09-01T08:00:00Z",
            "updated_at": "2026-09-02T08:00:00Z",
        })
    else:
        num_projects = 10 if profile == "load" else 100
        total_tasks = 1000 if profile == "load" else 10000

        projects = []
        project_members = []
        for p_id in range(1, num_projects + 1):
            projects.append({
                "id": p_id,
                "name": f"Dự án thử tải {p_id}",
                "description": f"Dự án thử tải {p_id}",
                "owner_id": 1,
                "version": 1,
                "archived_at": None,
                "created_at": "2026-10-01T08:00:00Z",
                "updated_at": "2026-10-01T08:00:00Z",
            })
            project_members.append({"project_id": p_id, "user_id": 1, "joined_at": "2026-10-01T08:00:00Z"})
            project_members.append({"project_id": p_id, "user_id": 2, "joined_at": "2026-10-01T08:00:00Z"})

        tasks = []
        for t_id in range(1, total_tasks + 1):
            project_id = (t_id - 1) // 100 + 1
            tasks.append({
                "id": t_id,
                "project_id": project_id,
                "title": f"{TITLES[(t_id - 1) % len(TITLES)]} #{t_id}",
                "description": f"Mô tả chi tiết công việc số {t_id} trong dự án quản lý task",
                "assignee_id": None if t_id % 4 == 0 else (1 if t_id % 2 == 1 else 2),
                "due_date": ["2026-10-01", "2026-10-10", "2026-10-13", "2026-10-20", None][t_id % 5],
                "priority": ["low", "medium", "high"][t_id % 3],
                "status": ["todo", "doing", "done"][t_id % 3],
                "version": 1,
                "archived_at": "2026-10-11T10:00:00Z" if t_id % 20 == 0 else None,
                "created_at": "2026-10-01T08:00:00Z",
                "updated_at": "2026-10-02T08:00:00Z",
            })

    return {
        "today": "2026-10-13",
        "users": users,
        "projects": projects,
        "project_members": project_members,
        "tasks": tasks,
        "comments": [],
        "task_history": [],
        "project_history": [],
    }
