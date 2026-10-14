'use strict';

// Các section dựng sẵn. Được dùng vừa làm "block" kéo thả trong trình soạn thảo,
// vừa để ghép thành các mẫu (template) landing page khởi đầu.

const BASE_CSS = `
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;line-height:1.6}
.htc-container{max-width:1120px;margin:0 auto;padding:0 20px}
.htc-btn{display:inline-block;padding:14px 28px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;border:0;cursor:pointer}
.htc-btn:hover{background:#1d4ed8}
.htc-btn-ghost{background:transparent;color:#2563eb;border:2px solid #2563eb}
.htc-section{padding:80px 0}
.htc-section h2{font-size:34px;margin:0 0 12px;text-align:center}
.htc-lead{color:#475569;font-size:18px;text-align:center;max-width:680px;margin:0 auto 40px}
.htc-nav{padding:18px 0;border-bottom:1px solid #e2e8f0}
.htc-nav .htc-container{display:flex;align-items:center;justify-content:space-between;gap:16px}
.htc-logo{font-weight:800;font-size:22px;color:#2563eb;text-decoration:none}
.htc-nav-links a{margin-left:20px;color:#334155;text-decoration:none}
.htc-hero{padding:100px 0;background:linear-gradient(135deg,#eff6ff,#f5f3ff);text-align:center}
.htc-hero h1{font-size:48px;line-height:1.15;margin:0 0 20px}
.htc-hero p{font-size:20px;color:#475569;max-width:720px;margin:0 auto 32px}
.htc-hero .htc-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.htc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}
.htc-card{padding:28px;border:1px solid #e2e8f0;border-radius:14px;background:#fff}
.htc-card h3{margin:8px 0}
.htc-icon{font-size:32px}
.htc-price{font-size:36px;font-weight:800;margin:12px 0}
.htc-card.htc-featured{border:2px solid #2563eb;box-shadow:0 10px 30px rgba(37,99,235,.15)}
.htc-card ul{padding-left:18px;color:#475569}
.htc-quote{font-style:italic;color:#334155}
.htc-cta{background:#1e3a8a;color:#fff;text-align:center}
.htc-cta h2{color:#fff}
.htc-cta p{color:#c7d2fe}
.htc-form{max-width:520px;margin:0 auto;display:grid;gap:14px}
.htc-form input,.htc-form textarea,.htc-form select{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}
.htc-footer{padding:32px 0;background:#0f172a;color:#94a3b8;text-align:center;font-size:14px}
@media (max-width:640px){.htc-hero h1{font-size:34px}.htc-section{padding:56px 0}.htc-nav-links{display:none}}
`.trim();

const SECTIONS = {
  navbar: {
    label: 'Thanh điều hướng',
    html: `<header class="htc-nav"><div class="htc-container">
  <a class="htc-logo" href="#">Thương hiệu</a>
  <nav class="htc-nav-links"><a href="#features">Tính năng</a><a href="#pricing">Bảng giá</a><a href="#contact">Liên hệ</a></nav>
</div></header>`,
  },
  hero: {
    label: 'Hero',
    html: `<section class="htc-hero"><div class="htc-container">
  <h1>Tăng trưởng doanh số với landing page chuyên nghiệp</h1>
  <p>Thiết kế, xuất bản và tối ưu chuyển đổi chỉ trong vài phút — không cần lập trình.</p>
  <div class="htc-actions"><a class="htc-btn" href="#contact">Dùng thử miễn phí</a><a class="htc-btn htc-btn-ghost" href="#features">Tìm hiểu thêm</a></div>
</div></section>`,
  },
  features: {
    label: 'Tính năng',
    html: `<section class="htc-section" id="features"><div class="htc-container">
  <h2>Vì sao chọn chúng tôi?</h2>
  <p class="htc-lead">Mọi thứ bạn cần để thu hút và chuyển đổi khách hàng.</p>
  <div class="htc-grid">
    <div class="htc-card"><div class="htc-icon">⚡</div><h3>Nhanh chóng</h3><p>Tốc độ tải trang tối ưu, chuẩn SEO.</p></div>
    <div class="htc-card"><div class="htc-icon">🎨</div><h3>Dễ tùy biến</h3><p>Kéo thả trực quan, đổi màu, font, bố cục tùy ý.</p></div>
    <div class="htc-card"><div class="htc-icon">📈</div><h3>Thu lead</h3><p>Biểu mẫu tích hợp, dữ liệu khách hàng về ngay dashboard.</p></div>
  </div>
</div></section>`,
  },
  pricing: {
    label: 'Bảng giá',
    html: `<section class="htc-section" id="pricing" style="background:#f8fafc"><div class="htc-container">
  <h2>Bảng giá đơn giản</h2>
  <p class="htc-lead">Chọn gói phù hợp với quy mô của bạn.</p>
  <div class="htc-grid">
    <div class="htc-card"><h3>Cơ bản</h3><div class="htc-price">0đ</div><ul><li>1 website</li><li>Tên miền phụ miễn phí</li></ul><a class="htc-btn htc-btn-ghost" href="#contact">Bắt đầu</a></div>
    <div class="htc-card htc-featured"><h3>Chuyên nghiệp</h3><div class="htc-price">199.000đ</div><ul><li>10 website</li><li>Tên miền riêng</li><li>Không gắn thương hiệu</li></ul><a class="htc-btn" href="#contact">Chọn gói</a></div>
    <div class="htc-card"><h3>Doanh nghiệp</h3><div class="htc-price">Liên hệ</div><ul><li>Không giới hạn</li><li>Hỗ trợ ưu tiên</li></ul><a class="htc-btn htc-btn-ghost" href="#contact">Liên hệ</a></div>
  </div>
</div></section>`,
  },
  testimonials: {
    label: 'Đánh giá',
    html: `<section class="htc-section"><div class="htc-container">
  <h2>Khách hàng nói gì?</h2>
  <div class="htc-grid">
    <div class="htc-card"><p class="htc-quote">“Tỉ lệ chuyển đổi tăng gấp đôi sau 1 tháng.”</p><strong>Nguyễn Văn A</strong><div>CEO, Công ty ABC</div></div>
    <div class="htc-card"><p class="htc-quote">“Đội marketing tự làm landing page mà không cần chờ IT.”</p><strong>Trần Thị B</strong><div>Marketing Manager</div></div>
  </div>
</div></section>`,
  },
  leadForm: {
    label: 'Form thu lead',
    html: `<section class="htc-section" id="contact"><div class="htc-container">
  <h2>Đăng ký nhận tư vấn</h2>
  <p class="htc-lead">Để lại thông tin, chúng tôi sẽ liên hệ trong 24 giờ.</p>
  <form class="htc-form">
    <input name="name" placeholder="Họ và tên" required>
    <input name="phone" placeholder="Số điện thoại" required>
    <input name="email" type="email" placeholder="Email">
    <textarea name="message" rows="4" placeholder="Nội dung cần tư vấn"></textarea>
    <button class="htc-btn" type="submit">Gửi đăng ký</button>
  </form>
</div></section>`,
  },
  cta: {
    label: 'Kêu gọi hành động',
    html: `<section class="htc-section htc-cta"><div class="htc-container">
  <h2>Sẵn sàng bắt đầu?</h2>
  <p>Hàng nghìn doanh nghiệp đã tin dùng. Đến lượt bạn!</p>
  <a class="htc-btn" style="background:#fff;color:#1e3a8a" href="#contact">Đăng ký ngay</a>
</div></section>`,
  },
  footer: {
    label: 'Chân trang',
    html: `<footer class="htc-footer"><div class="htc-container">© 2026 Thương hiệu của bạn. Bảo lưu mọi quyền.</div></footer>`,
  },
};

const TEMPLATES = {
  blank: {
    name: 'Trang trắng',
    description: 'Bắt đầu từ con số 0',
    sections: [],
  },
  saas: {
    name: 'Sản phẩm SaaS',
    description: 'Giới thiệu phần mềm / dịch vụ cloud',
    sections: ['navbar', 'hero', 'features', 'pricing', 'testimonials', 'leadForm', 'footer'],
  },
  leadgen: {
    name: 'Thu lead nhanh',
    description: 'Trang ngắn gọn tập trung vào biểu mẫu đăng ký',
    sections: ['hero', 'features', 'leadForm', 'footer'],
  },
  event: {
    name: 'Sự kiện / Webinar',
    description: 'Đăng ký tham dự sự kiện',
    sections: ['navbar', 'hero', 'testimonials', 'cta', 'leadForm', 'footer'],
  },
};

function renderTemplate(id) {
  const tpl = TEMPLATES[id];
  if (!tpl) return null;
  return {
    html: tpl.sections.map((s) => SECTIONS[s].html).join('\n'),
    css: BASE_CSS,
  };
}

function listTemplates() {
  return Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name, description: t.description }));
}

function listBlocks() {
  return Object.entries(SECTIONS).map(([id, s]) => ({ id, label: s.label, html: s.html }));
}

module.exports = { BASE_CSS, renderTemplate, listTemplates, listBlocks };
