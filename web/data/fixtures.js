export function createDemoFixtures() {
  const today = '2026-10-13';
  const users = [
    { id: 1, username: 'nguyen.van.a', display_name: 'Nguyen Van A' },
    { id: 2, username: 'tran.thi.b', display_name: 'Tran Thi B' },
    { id: 3, username: 'le.van.c', display_name: 'Le Van C' }
  ];
  const projects = [
    { id: 10, name: 'Dự án Quản lý', description: 'Hệ thống quản lý', owner_id: 1, version: 1, archived_at: null },
    { id: 11, name: 'Dự án AI', description: 'Nghiên cứu', owner_id: 1, version: 1, archived_at: null },
    { id: 20, name: 'Dự án Cũ', description: 'Lưu trữ', owner_id: 3, version: 1, archived_at: '2026-10-01T00:00:00Z' }
  ];
  const project_members = [
    { project_id: 10, user_id: 1 }, { project_id: 10, user_id: 2 },
    { project_id: 11, user_id: 1 }, { project_id: 20, user_id: 3 }
  ];
  const titles = [
    'Thiết kế giao diện trang đăng nhập', 'Tích hợp API xác thực OAuth2', 'Xây dựng module truy vấn task',
    'Viết unit test cho bộ lọc', 'Sửa lỗi phân trang danh sách', 'Tối ưu hiệu năng truy vấn database',
    'Cập nhật tài liệu API', 'Kiểm thử bảo mật đầu vào', 'Đánh giá code review', 'Triển khai CI/CD pipeline'
  ];
  const tasks = [];
  for (let i = 1; i <= 26; i++) {
    tasks.push({
      id: 100 + i,
      project_id: 10,
      title: titles[(i - 1) % titles.length] + ` #${i}`,
      description: `Mô tả chi tiết công việc số ${i} trong dự án quản lý task`,
      assignee_id: i % 4 === 0 ? null : (i % 2 === 1 ? 1 : 2),
      due_date: ['2026-10-01', '2026-10-10', '2026-10-13', '2026-10-20', null][i % 5],
      priority: ['low', 'medium', 'high'][i % 3],
      status: ['todo', 'doing', 'done'][i % 3],
      version: 1,
      archived_at: i === 26 ? '2026-10-11T10:00:00Z' : null,
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-02T08:00:00Z'
    });
  }
  tasks.push({
    id: 200, project_id: 20, title: 'Nhiệm vụ cũ', description: 'Cũ', assignee_id: 3,
    due_date: '2026-09-30', priority: 'low', status: 'done', version: 1,
    archived_at: null, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-02T08:00:00Z'
  });
  return { today, users, projects, project_members, tasks };
}
