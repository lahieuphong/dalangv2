# Deploy DALANG V2 lên https://dalangv2.hongvan.net

DALANG V2 là website tĩnh: chỉ cần upload thư mục build, không cần Node.js hay
database trên server. `dalangv2.hongvan.net` nằm chung server **IIS (Windows)**
với `dalang.hongvan.net` (V1), nhưng là **một site riêng với thư mục gốc
riêng**. Không upload V2 vào thư mục của V1.

## 1. Lần đầu: tạo site trên hosting

Chỉ làm một lần, trước khi upload.

1. Trong trang quản trị hosting, tạo site (hoặc subdomain)
   `dalangv2.hongvan.net` với thư mục gốc riêng.
2. Bật HTTPS cho site. Camera chỉ hoạt động trên HTTPS.
3. Bật chuyển hướng HTTP → HTTPS giống như site V1. `web.config` trong bản
   build cố ý không tự chuyển hướng, vì việc đó cần module URL Rewrite và sẽ
   gây lỗi 500 nếu server không cài.

## 2. Build và đóng gói

```bash
yarn install
yarn build
```

Kết quả nằm trong thư mục `dist/`, khoảng 42 MB, phần lớn là model và runtime
nhận diện tay. Người xem không tải hết chừng đó: trình duyệt chỉ lấy một bản
runtime phù hợp (khoảng 12 MB) cộng với model (khoảng 8 MB).

```
dist/
├── index.html
├── web.config             ← cấu hình cho IIS (bắt buộc trên server hiện tại)
├── .htaccess              ← cấu hình cho Apache/LiteSpeed (IIS bỏ qua file này)
├── favicon.svg, apple-touch-icon.png, og-image.jpg
├── assets/                ← JS/CSS có hash trong tên file
├── mediapipe/wasm/        ← runtime nhận diện tay (6 file, phải upload đủ)
└── models/hand_landmarker.task
```

Đóng gói thành một file nén để upload (chạy trong PowerShell, tại thư mục dự
án). File tạo ra khoảng 16 MB và không được commit lên git:

```powershell
New-Item -ItemType Directory -Force release | Out-Null
tar.exe -a -c -f release\dalangv2-production.zip -C dist (Get-ChildItem dist -Force -Name)
```

## 3. Upload: mọi file phải nằm ở THƯ MỤC GỐC của website

> **Lỗi hay gặp:** giải nén vào bên trong thư mục con (ví dụ đang đứng trong
> `assets/` khi bấm Extract). Khi đó trang hiện nền đen trống: `index.html` cũ
> ở gốc trỏ tới các file JS/CSS không còn tồn tại.

1. Mở File Manager của hosting và vào **thư mục gốc** của
   `dalangv2.hongvan.net` (thường tên là `httpdocs`, `wwwroot` hoặc
   `dalangv2.hongvan.net`). Kiểm tra lại tên site trước khi xóa gì: thư mục
   của `dalang.hongvan.net` (V1) trông rất giống.
2. **Xóa toàn bộ nội dung cũ** trong thư mục gốc: `index.html`, `assets/`,
   `mediapipe/`, `models/`, các file ảnh, `.htaccess`, `web.config`…
3. Vẫn đứng ở thư mục gốc, upload `dalangv2-production.zip` rồi bấm
   **Extract** ngay tại đó.
4. Sau khi giải nén, thư mục gốc phải có ngay `index.html`, `web.config` và
   thư mục `assets/`. Nếu thấy `assets/assets/` hoặc
   `dalangv2-production/index.html` thì nghĩa là đã giải nén sai chỗ.

## 4. Kiểm tra sau khi deploy

- [ ] Mở `https://dalangv2.hongvan.net`: khung camera ở trên hiện *Start the camera to perform*, sân khấu bóng ở dưới (không phải nền đen trống).
- [ ] Mở `http://dalangv2.hongvan.net` (không có `s`): tự chuyển sang `https://`.
- [ ] Bấm **Start camera**, cho phép camera: hình camera hiện lên, kèm dòng *Raise one or both hands into view*.
- [ ] Giơ tay lên: con rối nhỏ bám theo bàn tay và con rối trên sân khấu cử động theo từng ngón.
- [ ] Mở `https://dalangv2.hongvan.net/?simulate=1`: hai con rối tự diễn mà không cần camera. Dùng cách này khi máy kiểm tra không có webcam.
- [ ] `https://dalangv2.hongvan.net/models/hand_landmarker.task` tải về được (không báo 404).
- [ ] DevTools → Network: `vision_wasm_internal.wasm` có `Content-Type: application/wasm`.
- [ ] `https://dalangv2.hongvan.net/mediapipe/wasm/vision_wasm_module_internal.js` mở được (không báo 404). Bản này dùng khi việc nhận diện tay chạy trong Web Worker.
- [ ] Mở `https://dalangv2.hongvan.net/?debug=1` và bật camera: bảng số liệu hiện các dòng `source`, `model`, `tracking`, `latency`, `render`. Dòng `model` phải ghi nơi model đang chạy, ví dụ `main-thread · GPU`, không phải dấu `–`.
- [ ] DevTools → Console: không có lỗi đỏ.

Nếu trang chủ báo **500 Internal Server Error** ngay sau khi upload, hosting
đang khóa một mục trong `web.config`. Thử xóa khối `<httpProtocol>` trước
(header bảo mật); site vẫn chạy được, chỉ thiếu các header đó.

## 5. Cập nhật phiên bản mới

Chạy lại **bước 2** (build và đóng gói), rồi lặp lại **bước 3**: xóa nội
dung cũ, upload và giải nén ở thư mục gốc. `index.html` luôn được kiểm tra
lại (`no-cache`), còn file trong `assets/` có hash trong tên, nên người xem
nhận bản mới ngay.

## 6. Nếu chuyển sang hosting khác

- **Apache / LiteSpeed (cPanel, DirectAdmin):** dùng `.htaccess` có sẵn trong
  build. Nó tự chuyển HTTPS, đặt MIME `.wasm`, nén file, thêm header bảo mật
  và cache. Nhớ bật *Show Hidden Files* để thấy file này.
- **Nginx:** không đọc `.htaccess` hay `web.config`, nên cần cấu hình tương
  đương bên dưới. `add_header` trong một `location` sẽ thay thế các header ở
  cấp `server`, vì vậy header bảo mật được tách ra một file riêng và
  `include` lại ở từng nơi.

`/etc/nginx/snippets/dalangv2-headers.conf`:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Permissions-Policy "camera=(self), microphone=(), geolocation=(), payment=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'" always;
```

Site config:

```nginx
server {
    listen 80;
    server_name dalangv2.hongvan.net;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name dalangv2.hongvan.net;
    # ssl_certificate / ssl_certificate_key: theo chứng chỉ của bạn (ví dụ certbot)

    root /var/www/dalangv2.hongvan.net;   # nơi chứa nội dung dist/
    index index.html;

    gzip on;
    gzip_types text/css application/javascript text/javascript application/json image/svg+xml application/wasm;

    location = /index.html {
        include snippets/dalangv2-headers.conf;
        add_header Cache-Control "no-cache";
    }

    location /assets/ {
        include snippets/dalangv2-headers.conf;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location ~* \.wasm$ {
        types { }
        default_type application/wasm;
        include snippets/dalangv2-headers.conf;
        add_header Cache-Control "public, max-age=2592000";
    }

    location ~* \.task$ {
        types { }
        default_type application/octet-stream;
        include snippets/dalangv2-headers.conf;
        add_header Cache-Control "public, max-age=2592000";
    }

    location / {
        include snippets/dalangv2-headers.conf;
        try_files $uri $uri/ =404;
    }
}
```

Ảnh chia sẻ khi dán link (Facebook, Zalo…) là `og-image.jpg`, đã trỏ sẵn tới
`https://dalangv2.hongvan.net/og-image.jpg`. Địa chỉ site được ghi cứng trong
`index.html` (thẻ `canonical` và các thẻ `og:`), cần sửa ở đó nếu đổi tên miền.
