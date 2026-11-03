const API = "/api/users";
const GENDER_LABEL = { male: "Nam", female: "Nữ", other: "Khác" };

const $ = (sel) => document.querySelector(sel);
const form = $("#user-form");
let editingId = null;
let users = [];

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast" + (isError ? " error" : "");
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2500);
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.errors || ["Có lỗi xảy ra"]).join("\n"));
  return data;
}

// ---------- Router ----------
function route() {
  const hash = location.hash || "#/new";
  const [, page, id] = hash.split("/");
  document.querySelectorAll("nav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.route === (page === "edit" ? "list" : page))
  );
  $("#view-form").hidden = !(page === "new" || page === "edit");
  $("#view-list").hidden = page !== "list";

  if (page === "list") loadList();
  else if (page === "edit") openEdit(id);
  else openNew();
}

// ---------- Form ----------
function openNew() {
  editingId = null;
  form.reset();
  $("#form-errors").innerHTML = "";
  $("#form-title").textContent = "Nhập thông tin";
  $("#submit-btn").textContent = "Lưu";
}

async function openEdit(id) {
  editingId = id;
  form.reset();
  $("#form-errors").innerHTML = "";
  $("#form-title").textContent = `Chỉnh sửa #${id}`;
  $("#submit-btn").textContent = "Cập nhật";
  try {
    const user = await request(`${API}/${id}`);
    for (const [k, v] of Object.entries(user)) {
      if (form.elements[k]) form.elements[k].value = v ?? "";
    }
  } catch (e) {
    toast(e.message, true);
    location.hash = "#/list";
  }
}

function clientValidate(data) {
  const errors = [];
  if (!data.full_name.trim()) errors.push("Full name là bắt buộc");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push("Email không hợp lệ");
  return errors;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const errors = clientValidate(data);
  $("#form-errors").innerHTML = errors.map((m) => `<li>${escapeHtml(m)}</li>`).join("");
  if (errors.length) return;

  try {
    if (editingId) {
      await request(`${API}/${editingId}`, { method: "PUT", body: JSON.stringify(data) });
      toast("Đã cập nhật");
    } else {
      await request(API, { method: "POST", body: JSON.stringify(data) });
      toast("Đã lưu");
    }
    location.hash = "#/list";
  } catch (err) {
    $("#form-errors").innerHTML = err.message
      .split("\n")
      .map((m) => `<li>${escapeHtml(m)}</li>`)
      .join("");
  }
});

$("#cancel-btn").addEventListener("click", () => {
  if (editingId) location.hash = "#/list";
  else openNew();
});

// ---------- List ----------
async function loadList() {
  try {
    users = await request(API);
    renderList();
  } catch (e) {
    toast(e.message, true);
  }
}

function renderList() {
  const q = $("#search").value.trim().toLowerCase();
  const rows = users.filter(
    (u) => !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  );
  $("#empty").hidden = rows.length > 0;
  $("#user-rows").innerHTML = rows
    .map(
      (u) => `
      <tr>
        <td>${u.id}</td>
        <td>${escapeHtml(u.full_name)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.phone)}</td>
        <td>${escapeHtml(u.dob)}</td>
        <td>${escapeHtml(GENDER_LABEL[u.gender] || "")}</td>
        <td>${escapeHtml(u.address)}</td>
        <td class="actions-cell">
          <button class="small" data-edit="${u.id}">Sửa</button>
          <button class="small danger" data-delete="${u.id}">Xóa</button>
        </td>
      </tr>`
    )
    .join("");
}

$("#search").addEventListener("input", renderList);

$("#user-rows").addEventListener("click", async (e) => {
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.delete;
  if (editId) location.hash = `#/edit/${editId}`;
  if (deleteId && confirm(`Xóa bản ghi #${deleteId}?`)) {
    try {
      await request(`${API}/${deleteId}`, { method: "DELETE" });
      toast("Đã xóa");
      loadList();
    } catch (err) {
      toast(err.message, true);
    }
  }
});

window.addEventListener("hashchange", route);
route();
