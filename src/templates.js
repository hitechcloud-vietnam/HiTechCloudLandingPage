'use strict';

// Các section dựng sẵn có tham số. Được dùng vừa làm "block" kéo thả trong trình
// soạn thảo (với nội dung mặc định), vừa để ghép thành các mẫu theo ngành.

const { escapeHtml: e } = require('./render');

function baseCss({ primary = '#2563eb', primaryDark = '#1d4ed8', heroFrom = '#eff6ff', heroTo = '#f5f3ff', ctaBg = '#1e3a8a' } = {}) {
  return `
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;line-height:1.6}
img{max-width:100%;height:auto}
.htc-container{max-width:1120px;margin:0 auto;padding:0 20px}
.htc-btn{display:inline-block;padding:14px 28px;border-radius:10px;background:${primary};color:#fff;text-decoration:none;font-weight:600;border:0;cursor:pointer;font-size:16px}
.htc-btn:hover{background:${primaryDark}}
.htc-btn-ghost{background:transparent;color:${primary};border:2px solid ${primary}}
.htc-btn-ghost:hover{background:${primary};color:#fff}
.htc-section{padding:80px 0}
.htc-section h2{font-size:34px;line-height:1.2;margin:0 0 12px;text-align:center}
.htc-lead{color:#475569;font-size:18px;text-align:center;max-width:680px;margin:0 auto 40px}
.htc-alt{background:#f8fafc}
.htc-nav{padding:18px 0;border-bottom:1px solid #e2e8f0;background:#fff}
.htc-nav .htc-container{display:flex;align-items:center;justify-content:space-between;gap:16px}
.htc-logo{font-weight:800;font-size:22px;color:${primary};text-decoration:none}
.htc-nav-links a{margin-left:20px;color:#334155;text-decoration:none}
.htc-hero{padding:100px 0;background:linear-gradient(135deg,${heroFrom},${heroTo});text-align:center}
.htc-hero h1{font-size:48px;line-height:1.15;margin:0 0 20px}
.htc-hero p{font-size:20px;color:#475569;max-width:720px;margin:0 auto 32px}
.htc-badge{display:inline-block;padding:6px 14px;border-radius:999px;background:#fff;color:${primary};font-weight:600;font-size:14px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.htc-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.htc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}
.htc-card{padding:28px;border:1px solid #e2e8f0;border-radius:14px;background:#fff}
.htc-card h3{margin:8px 0}
.htc-icon{font-size:32px}
.htc-price{font-size:36px;font-weight:800;margin:12px 0}
.htc-card.htc-featured{border:2px solid ${primary};box-shadow:0 10px 30px rgba(15,23,42,.12)}
.htc-card ul{padding-left:18px;color:#475569}
.htc-quote{font-style:italic;color:#334155}
.htc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:24px;text-align:center}
.htc-stat strong{display:block;font-size:40px;color:${primary};line-height:1.1}
.htc-steps{counter-reset:step;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px}
.htc-step{position:relative;padding:28px 24px 24px;border-radius:14px;background:#fff;border:1px solid #e2e8f0}
.htc-step:before{counter-increment:step;content:counter(step);position:absolute;top:-16px;left:24px;width:32px;height:32px;border-radius:50%;background:${primary};color:#fff;font-weight:700;display:grid;place-items:center}
.htc-faq{max-width:760px;margin:0 auto}
.htc-faq details{border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-bottom:12px;background:#fff}
.htc-faq summary{font-weight:600;cursor:pointer}
.htc-faq p{margin:12px 0 0;color:#475569}
.htc-video{position:relative;max-width:860px;margin:0 auto;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#0f172a}
.htc-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.htc-countdown{display:flex;gap:12px;justify-content:center;margin:24px 0}
.htc-countdown div{min-width:76px;padding:12px;border-radius:10px;background:#fff;color:#0f172a;text-align:center}
.htc-countdown b{display:block;font-size:30px;line-height:1.1}
.htc-countdown span{font-size:12px;color:#64748b;text-transform:uppercase}
.htc-cta{background:${ctaBg};color:#fff;text-align:center}
.htc-cta h2{color:#fff}
.htc-cta p{color:rgba(255,255,255,.8)}
.htc-cta .htc-btn{background:#fff;color:${ctaBg}}
.htc-form{max-width:520px;margin:0 auto;display:grid;gap:14px}
.htc-form input,.htc-form textarea,.htc-form select{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;background:#fff}
.htc-footer{padding:32px 0;background:#0f172a;color:#94a3b8;text-align:center;font-size:14px}
.htc-footer a{color:#cbd5e1}
.htc-float{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:10px}
.htc-float a{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;color:#fff;text-decoration:none;font-size:22px;font-weight:700;box-shadow:0 6px 16px rgba(0,0,0,.2)}
.htc-float .htc-call{background:#16a34a}
.htc-float .htc-zalo{background:#0068ff;font-size:13px}
.htc-float .htc-mess{background:#0084ff}
@media (max-width:640px){.htc-hero{padding:72px 0}.htc-hero h1{font-size:34px}.htc-section{padding:56px 0}.htc-section h2{font-size:28px}.htc-nav-links{display:none}.htc-countdown div{min-width:64px}}
`.trim();
}

// ---------- Section builders ----------
const S = {
  navbar: ({ brand = 'Thương hiệu', links = [['#features', 'Tính năng'], ['#pricing', 'Bảng giá'], ['#contact', 'Liên hệ']] } = {}) =>
    `<header class="htc-nav"><div class="htc-container">
  <a class="htc-logo" href="#">${e(brand)}</a>
  <nav class="htc-nav-links">${links.map(([href, t]) => `<a href="${e(href)}">${e(t)}</a>`).join('')}</nav>
</div></header>`,

  hero: ({
    badge = '',
    title = 'Tăng trưởng doanh số với landing page chuyên nghiệp',
    text = 'Thiết kế, xuất bản và tối ưu chuyển đổi chỉ trong vài phút — không cần lập trình.',
    cta = 'Dùng thử miễn phí',
    cta2 = 'Tìm hiểu thêm',
    cta2Href = '#features',
  } = {}) =>
    `<section class="htc-hero"><div class="htc-container">
  ${badge ? `<div class="htc-badge">${e(badge)}</div>` : ''}
  <h1>${e(title)}</h1>
  <p>${e(text)}</p>
  <div class="htc-actions"><a class="htc-btn" href="#contact">${e(cta)}</a>${cta2 ? `<a class="htc-btn htc-btn-ghost" href="${e(cta2Href)}">${e(cta2)}</a>` : ''}</div>
</div></section>`,

  features: ({
    id = 'features',
    title = 'Vì sao chọn chúng tôi?',
    lead = 'Mọi thứ bạn cần để thu hút và chuyển đổi khách hàng.',
    items = [['⚡', 'Nhanh chóng', 'Tốc độ tải trang tối ưu, chuẩn SEO.'], ['🎨', 'Dễ tùy biến', 'Kéo thả trực quan, đổi màu, font, bố cục tùy ý.'], ['📈', 'Thu lead', 'Biểu mẫu tích hợp, dữ liệu khách hàng về ngay dashboard.']],
    alt = false,
  } = {}) =>
    `<section class="htc-section${alt ? ' htc-alt' : ''}" id="${e(id)}"><div class="htc-container">
  <h2>${e(title)}</h2>
  <p class="htc-lead">${e(lead)}</p>
  <div class="htc-grid">
${items.map(([icon, t, d]) => `    <div class="htc-card"><div class="htc-icon">${icon}</div><h3>${e(t)}</h3><p>${e(d)}</p></div>`).join('\n')}
  </div>
</div></section>`,

  pricing: ({
    title = 'Bảng giá đơn giản',
    lead = 'Chọn gói phù hợp với nhu cầu của bạn.',
    plans = [
      ['Cơ bản', '0đ', ['1 website', 'Tên miền phụ miễn phí'], false],
      ['Chuyên nghiệp', '199.000đ', ['10 website', 'Tên miền riêng', 'Không gắn thương hiệu'], true],
      ['Doanh nghiệp', 'Liên hệ', ['Không giới hạn', 'Hỗ trợ ưu tiên'], false],
    ],
  } = {}) =>
    `<section class="htc-section htc-alt" id="pricing"><div class="htc-container">
  <h2>${e(title)}</h2>
  <p class="htc-lead">${e(lead)}</p>
  <div class="htc-grid">
${plans.map(([name, price, perks, featured]) => `    <div class="htc-card${featured ? ' htc-featured' : ''}"><h3>${e(name)}</h3><div class="htc-price">${e(price)}</div><ul>${perks.map((p) => `<li>${e(p)}</li>`).join('')}</ul><a class="htc-btn${featured ? '' : ' htc-btn-ghost'}" href="#contact">Chọn gói</a></div>`).join('\n')}
  </div>
</div></section>`,

  testimonials: ({
    title = 'Khách hàng nói gì?',
    items = [['“Tỉ lệ chuyển đổi tăng gấp đôi sau 1 tháng.”', 'Nguyễn Văn A', 'CEO, Công ty ABC'], ['“Đội marketing tự làm landing page mà không cần chờ IT.”', 'Trần Thị B', 'Marketing Manager']],
  } = {}) =>
    `<section class="htc-section"><div class="htc-container">
  <h2>${e(title)}</h2>
  <div class="htc-grid">
${items.map(([q, name, role]) => `    <div class="htc-card"><p class="htc-quote">${e(q)}</p><strong>${e(name)}</strong><div>${e(role)}</div></div>`).join('\n')}
  </div>
</div></section>`,

  stats: ({ items = [['10.000+', 'Khách hàng'], ['98%', 'Hài lòng'], ['24/7', 'Hỗ trợ'], ['5 năm', 'Kinh nghiệm']] } = {}) =>
    `<section class="htc-section htc-alt"><div class="htc-container"><div class="htc-stats">
${items.map(([n, l]) => `  <div class="htc-stat"><strong>${e(n)}</strong>${e(l)}</div>`).join('\n')}
</div></div></section>`,

  steps: ({ id = 'steps', title = 'Quy trình đơn giản', items = [['Đăng ký', 'Để lại thông tin trong 30 giây.'], ['Tư vấn', 'Chuyên viên liên hệ trong 24 giờ.'], ['Bắt đầu', 'Sử dụng dịch vụ ngay.']] } = {}) =>
    `<section class="htc-section" id="${e(id)}"><div class="htc-container">
  <h2>${e(title)}</h2>
  <p class="htc-lead"></p>
  <div class="htc-steps">
${items.map(([t, d]) => `    <div class="htc-step"><h3>${e(t)}</h3><p>${e(d)}</p></div>`).join('\n')}
  </div>
</div></section>`,

  faq: ({
    title = 'Câu hỏi thường gặp',
    items = [['Tôi có cần biết lập trình không?', 'Không. Mọi thứ đều kéo thả trực quan.'], ['Có hỗ trợ tên miền riêng không?', 'Có, từ gói Pro trở lên.'], ['Thanh toán bằng cách nào?', 'Chuyển khoản ngân hàng qua mã QR, xác nhận tự động.']],
  } = {}) =>
    `<section class="htc-section htc-alt"><div class="htc-container">
  <h2>${e(title)}</h2>
  <p class="htc-lead"></p>
  <div class="htc-faq">
${items.map(([q, a]) => `    <details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('\n')}
  </div>
</div></section>`,

  video: ({ title = 'Xem video giới thiệu', youtubeId = 'dQw4w9WgXcQ' } = {}) =>
    `<section class="htc-section"><div class="htc-container">
  <h2>${e(title)}</h2>
  <p class="htc-lead"></p>
  <div class="htc-video"><iframe src="https://www.youtube-nocookie.com/embed/${e(youtubeId)}" title="Video" loading="lazy" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>
</div></section>`,

  // The countdown is driven by data-htc-countdown; render.js injects a small runtime.
  countdown: ({ title = 'Ưu đãi kết thúc sau', deadline = '2026-12-31T23:59:59+07:00', cta = 'Nhận ưu đãi ngay' } = {}) =>
    `<section class="htc-section htc-cta"><div class="htc-container">
  <h2>${e(title)}</h2>
  <div class="htc-countdown" data-htc-countdown="${e(deadline)}">
    <div><b data-unit="d">00</b><span>Ngày</span></div><div><b data-unit="h">00</b><span>Giờ</span></div><div><b data-unit="m">00</b><span>Phút</span></div><div><b data-unit="s">00</b><span>Giây</span></div>
  </div>
  <a class="htc-btn" href="#contact">${e(cta)}</a>
</div></section>`,

  leadForm: ({
    title = 'Đăng ký nhận tư vấn',
    lead = 'Để lại thông tin, chúng tôi sẽ liên hệ trong 24 giờ.',
    extra = '<textarea name="message" rows="4" placeholder="Nội dung cần tư vấn"></textarea>',
    button = 'Gửi đăng ký',
  } = {}) =>
    `<section class="htc-section" id="contact"><div class="htc-container">
  <h2>${e(title)}</h2>
  <p class="htc-lead">${e(lead)}</p>
  <form class="htc-form">
    <input name="name" placeholder="Họ và tên" required>
    <input name="phone" type="tel" placeholder="Số điện thoại" required>
    <input name="email" type="email" placeholder="Email">
    ${extra}
    <button class="htc-btn" type="submit">${e(button)}</button>
  </form>
</div></section>`,

  cta: ({ title = 'Sẵn sàng bắt đầu?', text = 'Hàng nghìn doanh nghiệp đã tin dùng. Đến lượt bạn!', button = 'Đăng ký ngay' } = {}) =>
    `<section class="htc-section htc-cta"><div class="htc-container">
  <h2>${e(title)}</h2>
  <p>${e(text)}</p>
  <a class="htc-btn" href="#contact">${e(button)}</a>
</div></section>`,

  footer: ({ text = '© 2026 Thương hiệu của bạn. Bảo lưu mọi quyền.' } = {}) =>
    `<footer class="htc-footer"><div class="htc-container">${e(text)}</div></footer>`,

  floatingContact: ({ phone = '0900000000', zalo = '0900000000', messenger = '' } = {}) =>
    `<div class="htc-float">
  ${messenger ? `<a class="htc-mess" href="https://m.me/${e(messenger)}" target="_blank" rel="noopener" title="Messenger">💬</a>` : ''}
  <a class="htc-zalo" href="https://zalo.me/${e(zalo)}" target="_blank" rel="noopener" title="Chat Zalo">Zalo</a>
  <a class="htc-call" href="tel:${e(phone)}" title="Gọi ngay">📞</a>
</div>`,
};

const BLOCKS = [
  ['navbar', 'Thanh điều hướng'],
  ['hero', 'Hero'],
  ['features', 'Tính năng'],
  ['stats', 'Con số ấn tượng'],
  ['steps', 'Quy trình'],
  ['pricing', 'Bảng giá'],
  ['testimonials', 'Đánh giá'],
  ['faq', 'Câu hỏi thường gặp'],
  ['video', 'Video YouTube'],
  ['countdown', 'Đếm ngược ưu đãi'],
  ['leadForm', 'Form thu lead'],
  ['cta', 'Kêu gọi hành động'],
  ['floatingContact', 'Nút gọi / Zalo nổi'],
  ['footer', 'Chân trang'],
];

const sel = (label, name, options) =>
  `<select name="${name}" required><option value="">${e(label)}</option>${options.map((o) => `<option>${e(o)}</option>`).join('')}</select>`;

const TEMPLATES = {
  blank: { name: 'Trang trắng', description: 'Bắt đầu từ con số 0', build: () => [] },

  saas: {
    name: 'Sản phẩm SaaS',
    description: 'Giới thiệu phần mềm / dịch vụ cloud',
    build: () => [S.navbar(), S.hero({ badge: '🚀 Mới ra mắt' }), S.features(), S.stats(), S.pricing(), S.testimonials(), S.faq(), S.leadForm(), S.footer()],
  },

  leadgen: {
    name: 'Thu lead nhanh',
    description: 'Trang ngắn gọn tập trung vào biểu mẫu đăng ký',
    build: () => [S.hero({ cta2: '' }), S.features(), S.leadForm(), S.footer(), S.floatingContact()],
  },

  event: {
    name: 'Sự kiện / Webinar',
    description: 'Đăng ký tham dự sự kiện, có đếm ngược',
    build: () => [
      S.navbar({ brand: 'Webinar 2026', links: [['#agenda', 'Nội dung'], ['#contact', 'Đăng ký']] }),
      S.hero({ badge: '📅 20:00 · Thứ Bảy, 15/11/2026 · Online', title: 'Bí quyết tăng gấp đôi doanh số bằng Digital Marketing', text: 'Webinar miễn phí 90 phút cùng chuyên gia. Số lượng chỗ có hạn.', cta: 'Giữ chỗ miễn phí', cta2: 'Xem nội dung', cta2Href: '#agenda' }),
      S.countdown({ title: 'Sự kiện bắt đầu sau', deadline: '2026-11-15T20:00:00+07:00', cta: 'Đăng ký ngay' }),
      S.steps({ id: 'agenda', title: 'Nội dung chương trình', items: [['Xu hướng 2026', 'Bức tranh thị trường và hành vi khách hàng.'], ['Phễu chuyển đổi', 'Xây dựng landing page & quảng cáo hiệu quả.'], ['Hỏi đáp', 'Giải đáp trực tiếp cùng diễn giả.']] }),
      S.testimonials({ title: 'Học viên nói gì?' }),
      S.leadForm({ title: 'Đăng ký tham dự', lead: 'Link tham gia sẽ được gửi qua email và Zalo.', extra: sel('Bạn biết sự kiện qua…', 'source', ['Facebook', 'Zalo', 'Bạn bè giới thiệu', 'Khác']), button: 'Giữ chỗ miễn phí' }),
      S.footer(),
    ],
  },

  spa: {
    name: 'Spa / Thẩm mỹ',
    description: 'Đặt lịch làm đẹp, ưu đãi khách hàng mới',
    palette: { primary: '#db2777', primaryDark: '#be185d', heroFrom: '#fdf2f8', heroTo: '#fff7ed', ctaBg: '#831843' },
    build: () => [
      S.navbar({ brand: 'Lotus Spa', links: [['#services', 'Dịch vụ'], ['#pricing', 'Bảng giá'], ['#contact', 'Đặt lịch']] }),
      S.hero({ badge: '🌸 Giảm 30% cho khách hàng mới', title: 'Đánh thức vẻ đẹp tự nhiên của bạn', text: 'Liệu trình chăm sóc da chuẩn y khoa, chuyên viên giàu kinh nghiệm, không gian thư giãn tuyệt đối.', cta: 'Đặt lịch ngay', cta2: 'Xem dịch vụ', cta2Href: '#services' }),
      S.features({ id: 'services', title: 'Dịch vụ nổi bật', lead: 'Liệu trình cá nhân hóa theo từng làn da.', items: [['✨', 'Chăm sóc da mặt', 'Làm sạch sâu, cấp ẩm, trẻ hóa.'], ['💆', 'Massage trị liệu', 'Giảm căng thẳng, lưu thông khí huyết.'], ['🌿', 'Triệt lông', 'Công nghệ Diode Laser an toàn, không đau.']] }),
      S.pricing({ title: 'Bảng giá ưu đãi', lead: 'Áp dụng đến hết tháng này.', plans: [['Chăm sóc da cơ bản', '299.000đ', ['60 phút', 'Soi da miễn phí'], false], ['Trẻ hóa chuyên sâu', '890.000đ', ['90 phút', 'Tặng mặt nạ vàng', 'Tái khám miễn phí'], true], ['Combo 10 buổi', '6.990.000đ', ['Tiết kiệm 25%', 'Ưu tiên đặt lịch'], false]] }),
      S.testimonials({ items: [['“Da mình cải thiện rõ sau 3 buổi, nhân viên rất nhẹ nhàng.”', 'Chị Lan', 'Quận 7'], ['“Không gian sạch sẽ, thư giãn, giá hợp lý.”', 'Chị Mai', 'Quận 1']] }),
      S.leadForm({ title: 'Đặt lịch hẹn', lead: 'Spa sẽ gọi xác nhận trong 15 phút.', extra: sel('Chọn dịch vụ', 'service', ['Chăm sóc da mặt', 'Massage trị liệu', 'Triệt lông', 'Tư vấn liệu trình']) + '\n    <input name="date" type="date">', button: 'Đặt lịch' }),
      S.footer({ text: '© 2026 Lotus Spa · 123 Nguyễn Huệ, Quận 1, TP.HCM · Hotline 0900 000 000' }),
      S.floatingContact(),
    ],
  },

  realestate: {
    name: 'Bất động sản',
    description: 'Giới thiệu dự án, nhận bảng giá & đặt lịch tham quan',
    palette: { primary: '#b45309', primaryDark: '#92400e', heroFrom: '#fffbeb', heroTo: '#f5f5f4', ctaBg: '#1c1917' },
    build: () => [
      S.navbar({ brand: 'Sunrise Residence', links: [['#features', 'Tiện ích'], ['#pricing', 'Giá bán'], ['#contact', 'Nhận báo giá']] }),
      S.hero({ badge: '🏙️ Mở bán đợt 1 · Chiết khấu 8%', title: 'Căn hộ ven sông — sống xanh giữa lòng thành phố', text: 'Sổ hồng lâu dài, thanh toán 30% nhận nhà, ngân hàng hỗ trợ vay 70% lãi suất 0% trong 24 tháng.', cta: 'Nhận bảng giá', cta2: 'Xem tiện ích' }),
      S.stats({ items: [['2,5 ha', 'Tổng diện tích'], ['70%', 'Mật độ cây xanh'], ['15 phút', 'Đến trung tâm'], ['2027', 'Bàn giao']] }),
      S.features({ title: 'Tiện ích đẳng cấp', lead: 'Hơn 40 tiện ích nội khu chuẩn resort.', items: [['🏊', 'Hồ bơi tràn bờ', 'Tầm nhìn panorama ra sông.'], ['🌳', 'Công viên nội khu', '5.000 m² cây xanh và đường dạo bộ.'], ['🏫', 'Trường học liên cấp', 'Ngay trong khuôn viên dự án.']] }),
      S.pricing({ title: 'Giá bán tham khảo', lead: 'Giá đã bao gồm VAT, chưa gồm phí bảo trì.', plans: [['1 phòng ngủ', 'từ 2,1 tỷ', ['50 m²', 'Ban công riêng'], false], ['2 phòng ngủ', 'từ 3,2 tỷ', ['72 m²', 'View sông', 'Chiết khấu 8%'], true], ['3 phòng ngủ', 'từ 4,6 tỷ', ['98 m²', 'Căn góc'], false]] }),
      S.video({ title: 'Video thực tế dự án' }),
      S.leadForm({ title: 'Nhận bảng giá & chính sách mới nhất', lead: 'Chuyên viên tư vấn sẽ gửi tài liệu qua Zalo trong 5 phút.', extra: sel('Nhu cầu', 'need', ['Mua để ở', 'Đầu tư', 'Đặt lịch tham quan nhà mẫu']), button: 'Nhận bảng giá' }),
      S.footer({ text: '© 2026 Sunrise Residence · Thông tin mang tính tham khảo.' }),
      S.floatingContact(),
    ],
  },

  education: {
    name: 'Khóa học / Giáo dục',
    description: 'Tuyển sinh khóa học, học thử miễn phí',
    palette: { primary: '#7c3aed', primaryDark: '#6d28d9', heroFrom: '#f5f3ff', heroTo: '#ecfeff', ctaBg: '#4c1d95' },
    build: () => [
      S.navbar({ brand: 'Smart English', links: [['#features', 'Khóa học'], ['#pricing', 'Học phí'], ['#contact', 'Học thử']] }),
      S.hero({ badge: '🎓 Học thử miễn phí 1 buổi', title: 'Tự tin giao tiếp tiếng Anh sau 3 tháng', text: 'Lộ trình cá nhân hóa, giáo viên bản ngữ, cam kết đầu ra bằng văn bản.', cta: 'Đăng ký học thử', cta2: 'Xem lộ trình' }),
      S.stats({ items: [['15.000+', 'Học viên'], ['92%', 'Đạt mục tiêu'], ['50+', 'Giáo viên'], ['4,9/5', 'Đánh giá']] }),
      S.steps({ title: 'Lộ trình học', items: [['Kiểm tra trình độ', 'Đánh giá 4 kỹ năng miễn phí.'], ['Học theo lộ trình', 'Lớp nhỏ 6–8 học viên.'], ['Cam kết đầu ra', 'Học lại miễn phí nếu chưa đạt.']] }),
      S.pricing({ title: 'Học phí', lead: 'Hỗ trợ trả góp 0%.', plans: [['Cơ bản', '2.900.000đ', ['24 buổi', 'Giáo viên Việt'], false], ['Giao tiếp', '5.900.000đ', ['36 buổi', 'Giáo viên bản ngữ', 'Cam kết đầu ra'], true], ['1 kèm 1', 'Liên hệ', ['Lịch học linh hoạt'], false]] }),
      S.faq({ items: [['Tôi mất gốc có học được không?', 'Có, lộ trình bắt đầu từ nền tảng.'], ['Học online hay offline?', 'Cả hai, bạn có thể chuyển đổi linh hoạt.'], ['Có hoàn học phí không?', 'Hoàn 100% nếu không hài lòng sau buổi đầu.']] }),
      S.leadForm({ title: 'Đăng ký học thử miễn phí', lead: 'Tư vấn viên gọi lại trong 24 giờ.', extra: sel('Mục tiêu', 'goal', ['Giao tiếp', 'IELTS', 'Tiếng Anh cho trẻ em', 'Tiếng Anh doanh nghiệp']), button: 'Đăng ký học thử' }),
      S.footer({ text: '© 2026 Smart English Center' }),
    ],
  },

  restaurant: {
    name: 'Nhà hàng / F&B',
    description: 'Thực đơn nổi bật và đặt bàn',
    palette: { primary: '#dc2626', primaryDark: '#b91c1c', heroFrom: '#fef2f2', heroTo: '#fff7ed', ctaBg: '#7f1d1d' },
    build: () => [
      S.navbar({ brand: 'Bếp Việt', links: [['#features', 'Thực đơn'], ['#contact', 'Đặt bàn']] }),
      S.hero({ badge: '🍜 Mở cửa 10:00 – 22:00 mỗi ngày', title: 'Hương vị Việt chuẩn vị nhà làm', text: 'Nguyên liệu tươi mỗi ngày, không gian ấm cúng cho gia đình và bạn bè.', cta: 'Đặt bàn ngay', cta2: 'Xem thực đơn' }),
      S.features({ title: 'Món đặc trưng', lead: 'Được thực khách yêu thích nhất.', items: [['🍲', 'Lẩu cá kèo', 'Chua cay đậm đà kiểu miền Tây.'], ['🥢', 'Bún chả Hà Nội', 'Chả nướng than hoa thơm lừng.'], ['🦐', 'Gỏi cuốn tôm thịt', 'Tươi mát, chấm tương đậu phộng.']] }),
      S.countdown({ title: 'Ưu đãi giảm 20% hóa đơn kết thúc sau', cta: 'Đặt bàn nhận ưu đãi' }),
      S.testimonials({ items: [['“Món ăn ngon, phục vụ nhanh, giá hợp lý.”', 'Anh Tuấn', 'Google Maps ★★★★★'], ['“Không gian đẹp, phù hợp họp mặt gia đình.”', 'Chị Hoa', 'Foody ★★★★★']] }),
      S.leadForm({ title: 'Đặt bàn', lead: 'Nhà hàng sẽ gọi xác nhận ngay.', extra: '<input name="date" type="datetime-local" required>\n    <input name="guests" type="number" min="1" placeholder="Số khách" required>', button: 'Xác nhận đặt bàn' }),
      S.footer({ text: '© 2026 Bếp Việt · 45 Lê Lợi, Quận 1 · 0900 000 000' }),
      S.floatingContact(),
    ],
  },

  product: {
    name: 'Bán sản phẩm',
    description: 'Bán 1 sản phẩm, đặt hàng COD',
    palette: { primary: '#ea580c', primaryDark: '#c2410c', heroFrom: '#fff7ed', heroTo: '#fefce8', ctaBg: '#7c2d12' },
    build: () => [
      S.hero({ badge: '🔥 Giảm 40% hôm nay · Freeship toàn quốc', title: 'Máy lọc không khí thông minh AirPure', text: 'Lọc 99,97% bụi mịn PM2.5, điều khiển qua điện thoại, vận hành siêu êm. Bảo hành 24 tháng, đổi trả 7 ngày.', cta: 'Đặt hàng ngay', cta2: 'Xem chi tiết' }),
      S.features({ title: 'Vì sao nên chọn AirPure?', lead: '', items: [['🌬️', 'Lọc HEPA H13', 'Loại bỏ bụi mịn, phấn hoa, vi khuẩn.'], ['📱', 'Điều khiển thông minh', 'Theo dõi chất lượng không khí trên app.'], ['🔇', 'Siêu êm 22dB', 'Yên tĩnh khi ngủ.']] }),
      S.countdown({ title: 'Giá sốc chỉ còn', cta: 'Mua ngay giá 1.990.000đ' }),
      S.testimonials({ items: [['“Con mình bớt hắt hơi hẳn từ khi dùng máy.”', 'Chị Ngọc', 'Đã mua hàng'], ['“Giao nhanh, đóng gói cẩn thận.”', 'Anh Minh', 'Đã mua hàng']] }),
      S.faq({ items: [['Thanh toán thế nào?', 'Thanh toán khi nhận hàng (COD) hoặc chuyển khoản.'], ['Bao lâu nhận được hàng?', '1–3 ngày tùy khu vực.'], ['Bảo hành ra sao?', '24 tháng chính hãng, 1 đổi 1 trong 7 ngày.']] }),
      S.leadForm({ title: 'Đặt hàng — thanh toán khi nhận', lead: 'Nhân viên gọi xác nhận đơn trong 30 phút.', extra: '<input name="address" placeholder="Địa chỉ nhận hàng" required>\n    ' + sel('Số lượng', 'quantity', ['1 máy – 1.990.000đ', '2 máy – 3.790.000đ', '3 máy – 5.490.000đ']), button: 'Đặt hàng' }),
      S.footer(),
      S.floatingContact(),
    ],
  },
};

function renderTemplate(id) {
  const tpl = TEMPLATES[id];
  if (!tpl) return null;
  return { html: tpl.build().join('\n'), css: baseCss(tpl.palette) };
}

function listTemplates() {
  return Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name, description: t.description }));
}

function listBlocks() {
  return BLOCKS.map(([id, label]) => ({ id, label, html: S[id]() }));
}

const BASE_CSS = baseCss();

module.exports = { BASE_CSS, renderTemplate, listTemplates, listBlocks };
