
/* =========================================================
   SALARY PORTAL — ADMIN WORKSPACE
   Uses existing supabase.js and existing database schema.
========================================================= */

const $ = (id) => document.getElementById(id);

let currentUser = null;
let companies = [];
let employees = [];
let salarySlips = [];
let currentPage = "overview";
let removeExistingLogo = false;

const LOGO_BUCKET = "company-logos";

const PAGE_INFO = {
  overview: ["Overview", "Your payroll activity at a glance."],
  companies: ["Companies", "Manage company profiles, registered details and logos."],
  employees: ["Employees", "Manage employee records and activation."],
  "create-slip": ["Salary Slip Creation", "Prepare and save monthly payroll."],
  "saved-slips": ["Saved Salary Slips", "Search existing payroll records and download PDFs."]
};

/* -------------------- UTILITIES -------------------- */

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

function money(value) {
  return "₹" + Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function showMessage(id, message, type = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = message || "";
  el.className = "message" + (type ? " " + type : "");
}

function showGlobalMessage(message, type = "") {
  showMessage("globalMessage", message, type);
  if (message) window.scrollTo({ top: 0, behavior: "smooth" });
}

function companyName(companyId) {
  return companies.find(c => c.id === companyId)?.name || "Unknown company";
}

function monthLabel(monthValue) {
  if (!monthValue) return "—";
  const date = new Date(monthValue.slice(0, 7) + "-01T00:00:00");
  if (Number.isNaN(date.getTime())) return monthValue;

  return date.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric"
  });
}

function setButtonBusy(button, busy, busyText = "Please wait…") {
  if (!button) return;

  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function logoPublicUrl(path) {
  if (!path) return null;

  const { data } = supabaseClient.storage
    .from(LOGO_BUCKET)
    .getPublicUrl(path);

  return data?.publicUrl || null;
}

function activeCompany() {
  return companies.find(c => c.is_active) || null;
}

/* -------------------- NAVIGATION -------------------- */

function navigate(page) {
  if (!PAGE_INFO[page]) return;

  currentPage = page;

  document.querySelectorAll(".page").forEach(section => {
    section.classList.toggle("active", section.id === "page-" + page);
  });

  document.querySelectorAll(".nav-btn[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  $("topTitle").textContent = PAGE_INFO[page][0];
  $("topSubtitle").textContent = PAGE_INFO[page][1];

  if (page === "companies") renderCompanies();
  if (page === "employees") renderEmployees();
  if (page === "saved-slips") renderSalarySlips();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-btn[data-page]").forEach(button => {
  button.addEventListener("click", () => navigate(button.dataset.page));
});

document.querySelectorAll("[data-go]").forEach(button => {
  button.addEventListener("click", () => navigate(button.dataset.go));
});

/* -------------------- AUTH -------------------- */

async function requireAdmin() {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data?.user) {
    window.location.replace("login.html");
    return false;
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError || profile?.role !== "admin") {
    await supabaseClient.auth.signOut();
    window.location.replace("login.html");
    return false;
  }

  currentUser = data.user;
  $("sidebarEmail").textContent = currentUser.email || "Administrator";

  if ($("adminEmail")) {
    $("adminEmail").textContent = currentUser.email || "";
  }

  return true;
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.replace("login.html");
}

$("logoutBtn").addEventListener("click", logout);
$("topLogoutBtn").addEventListener("click", logout);

/* -------------------- COMPANIES -------------------- */

async function loadCompanies() {
  const { data, error } = await supabaseClient
    .from("companies")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  companies = data || [];
  renderCompanies();
  populateCompanySelects();
  renderCurrentCompany();
  renderDashboardCounts();
}

function renderCompanies() {
  const query = ($("companySearch").value || "").trim().toLowerCase();

  const list = companies.filter(company =>
    !query ||
    (company.name || "").toLowerCase().includes(query) ||
    (company.address || "").toLowerCase().includes(query) ||
    (company.gstin || "").toLowerCase().includes(query)
  );

  $("companiesTable").innerHTML = list.length
    ? list.map(company => `
      <tr>
        <td>
          <span class="primary-cell">${escapeHTML(company.name)}</span>
          <span class="sub-cell">${escapeHTML(company.address || "Address not added")}</span>
        </td>
        <td>
          ${escapeHTML(company.gstin || "—")}
          <span class="sub-cell">TAN: ${escapeHTML(company.tan || "—")}</span>
        </td>
        <td>
          <span class="status ${company.is_active ? "" : "inactive"}">
            ${company.is_active ? "Current company" : "Not current"}
          </span>
        </td>
        <td>
          <div class="actions tight">
            <button type="button" class="btn secondary small" data-edit-company="${escapeHTML(company.id)}">Edit</button>
            ${!company.is_active
              ? `<button type="button" class="btn small" data-current-company="${escapeHTML(company.id)}">Make current</button>`
              : ""}
            ${company.logo_path
              ? `<button type="button" class="btn secondary small" data-view-logo="${escapeHTML(company.id)}">Logo</button>`
              : ""}
            <button type="button" class="btn danger small" data-delete-company="${escapeHTML(company.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="4"><div class="empty-state">
        <div class="empty-icon">▣</div>
        ${query ? "No companies match your search." : "No companies added yet. Use the form below to create your first company."}
      </div></td></tr>`;
}

$("companySearch").addEventListener("input", renderCompanies);

function populateCompanySelects() {
  const options = companies.map(c =>
    `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}${c.is_active ? " · Current" : ""}</option>`
  ).join("");

  const employeeSelect = $("employeeCompany");
  const salaryCompanySelect = $("salaryCompany");
  const employeeFilter = $("employeeFilterCompany");
  const slipFilter = $("slipFilterCompany");

  const previousEmployee = employeeSelect.value;
  const previousSalaryCompany = salaryCompanySelect.value;
  const previousEmployeeFilter = employeeFilter.value;
  const previousSlipFilter = slipFilter.value;

  employeeSelect.innerHTML = '<option value="">Select company</option>' + options;
  salaryCompanySelect.innerHTML = '<option value="">Select company</option>' + options;
  employeeFilter.innerHTML = '<option value="">All companies</option>' + options;
  slipFilter.innerHTML = '<option value="">All companies</option>' + options;

  if (companies.some(c => c.id === previousEmployee)) {
    employeeSelect.value = previousEmployee;
  } else if (activeCompany()) {
    employeeSelect.value = activeCompany().id;
  }

  if (companies.some(c => c.id === previousSalaryCompany)) {
    salaryCompanySelect.value = previousSalaryCompany;
  } else if (activeCompany()) {
    salaryCompanySelect.value = activeCompany().id;
  }

  if (companies.some(c => c.id === previousEmployeeFilter)) {
    employeeFilter.value = previousEmployeeFilter;
  }

  if (companies.some(c => c.id === previousSlipFilter)) {
    slipFilter.value = previousSlipFilter;
  }

  renderSalaryEmployeeOptions();
  updateEmployeeCodeSuggestion();
  renderCurrentCompany();
}

function renderCurrentCompany() {
  const company = activeCompany();

  $("currentCompanyName").textContent = company?.name || "No company selected";
  $("currentCompanyDetails").textContent = company
    ? `${company.address || "Address not added"} · GSTIN: ${company.gstin || "—"} · TAN: ${company.tan || "—"}`
    : "Add a company and set it as current to begin payroll.";

  $("salaryCurrentCompanyName").textContent = company?.name || "Select a company";
  $("salaryCurrentCompanyDetails").textContent = company
    ? `${company.address || "Address not added"} · GSTIN: ${company.gstin || "—"} · TAN: ${company.tan || "—"}`
    : "Add a company first.";
}

function resetCompanyForm() {
  $("companyForm").reset();
  $("companyId").value = "";
  $("companyFormTitle").textContent = "Add a company";
  $("saveCompanyBtn").textContent = "Save company";
  $("cancelCompanyEditBtn").hidden = true;
  $("logoPreview").hidden = true;
  $("logoPreview").removeAttribute("src");
  $("companyLogo").value = "";
  $("makeCurrent").checked = companies.length === 0;
  removeExistingLogo = false;
  showMessage("companyMessage", "");
}

$("resetCompanyBtn").addEventListener("click", resetCompanyForm);
$("cancelCompanyEditBtn").addEventListener("click", resetCompanyForm);

$("newCompanyBtn").addEventListener("click", () => {
  resetCompanyForm();
  $("companyFormPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  $("companyName").focus();
});

$("removeLogoBtn").addEventListener("click", () => {
  removeExistingLogo = true;
  $("companyLogo").value = "";
  $("logoPreview").hidden = true;
  $("logoPreview").removeAttribute("src");
  showMessage("companyMessage", "Current logo will be removed when you save.", "success");
});

$("companyLogo").addEventListener("change", () => {
  const file = $("companyLogo").files[0];
  if (!file) return;

  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    $("companyLogo").value = "";
    showMessage("companyMessage", "Choose a PNG, JPG or WebP image.", "error");
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    $("companyLogo").value = "";
    showMessage("companyMessage", "Logo size must be 2 MB or less.", "error");
    return;
  }

  $("logoPreview").src = URL.createObjectURL(file);
  $("logoPreview").hidden = false;
  removeExistingLogo = false;
  showMessage("companyMessage", "");
});

async function uploadLogo(file, companyId) {
  if (!file) return null;

  const extension = file.type === "image/png" ? "png"
    : file.type === "image/webp" ? "webp" : "jpg";

  const path = `${companyId}/${Date.now()}.${extension}`;

  const { error } = await supabaseClient.storage
    .from(LOGO_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type
    });

  if (error) throw error;
  return path;
}

$("companyForm").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("saveCompanyBtn");
  setButtonBusy(button, true, "Saving…");
  showMessage("companyMessage", "");

  let uploadedPath = null;

  try {
    const id = $("companyId").value;
    const previousCompany = companies.find(c => c.id === id);

    const payload = {
      name: $("companyName").value.trim(),
      address: $("companyAddress").value.trim(),
      gstin: $("companyGstin").value.trim() || null,
      tan: $("companyTan").value.trim() || null
    };

    if (!payload.name || !payload.address) {
      throw new Error("Company name and full address are required.");
    }

    let companyId = id;

    if (id) {
      const { error } = await supabaseClient
        .from("companies")
        .update(payload)
        .eq("id", id);

      if (error) throw error;
    } else {
      const { data, error } = await supabaseClient
        .from("companies")
        .insert({
          ...payload,
          is_active: companies.length === 0
        })
        .select("id")
        .single();

      if (error) throw error;
      companyId = data.id;
    }

    const file = $("companyLogo").files[0];
    let logoPath = previousCompany?.logo_path || null;

    if (file) {
      uploadedPath = await uploadLogo(file, companyId);
      logoPath = uploadedPath;
    } else if (removeExistingLogo) {
      logoPath = null;
    }

    if (file || removeExistingLogo) {
      const { error } = await supabaseClient
        .from("companies")
        .update({ logo_path: logoPath })
        .eq("id", companyId);

      if (error) throw error;

      if (removeExistingLogo && previousCompany?.logo_path) {
        const { error: removeError } = await supabaseClient.storage
          .from(LOGO_BUCKET)
          .remove([previousCompany.logo_path]);

        if (removeError) console.warn("Old logo removal failed:", removeError.message);
      }

      if (file && previousCompany?.logo_path && previousCompany.logo_path !== uploadedPath) {
        const { error: removeError } = await supabaseClient.storage
          .from(LOGO_BUCKET)
          .remove([previousCompany.logo_path]);

        if (removeError) console.warn("Old logo removal failed:", removeError.message);
      }
    }

    if ($("makeCurrent").checked || companies.length === 0) {
      await makeCurrentCompany(companyId, false);
    }

    resetCompanyForm();
    await loadCompanies();
    await loadEmployees();
    showMessage("companyMessage", "Company saved successfully.", "success");
  } catch (error) {
    console.error(error);
    showMessage("companyMessage", error.message || "Could not save company.", "error");
  } finally {
    setButtonBusy(button, false);
  }
});

function editCompany(id) {
  const company = companies.find(c => c.id === id);
  if (!company) return;

  resetCompanyForm();

  $("companyId").value = company.id;
  $("companyName").value = company.name || "";
  $("companyAddress").value = company.address || "";
  $("companyGstin").value = company.gstin || "";
  $("companyTan").value = company.tan || "";
  $("makeCurrent").checked = !!company.is_active;

  $("companyFormTitle").textContent = "Edit company";
  $("saveCompanyBtn").textContent = "Update company";
  $("cancelCompanyEditBtn").hidden = false;

  if (company.logo_path) {
    $("logoPreview").src = logoPublicUrl(company.logo_path);
    $("logoPreview").hidden = false;
  }

  $("companyFormPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function makeCurrentCompany(id, reload = true) {
  const company = companies.find(c => c.id === id);
  if (!company) throw new Error("Company not found.");

  const { error: clearError } = await supabaseClient
    .from("companies")
    .update({ is_active: false })
    .neq("id", id);

  if (clearError) throw clearError;

  const { error } = await supabaseClient
    .from("companies")
    .update({ is_active: true })
    .eq("id", id);

  if (error) throw error;

  if (reload) {
    await loadCompanies();
    showGlobalMessage(`${company.name} is now the current company.`, "success");
  }
}

async function viewCompanyLogo(id) {
  const company = companies.find(c => c.id === id);
  if (!company?.logo_path) return;

  const url = logoPublicUrl(company.logo_path);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

async function deleteCompany(id) {
  const company = companies.find(c => c.id === id);
  if (!company) return;

  const confirmed = confirm(
    `Permanently delete "${company.name}" and all its employees, salary slips, activation codes and logo? This cannot be undone.`
  );
  if (!confirmed) return;

  try {
    const { data: employeeRows, error: employeeError } = await supabaseClient
      .from("employees")
      .select("id")
      .eq("company_id", id);

    if (employeeError) throw employeeError;

    const employeeIds = (employeeRows || []).map(e => e.id);

    let result = await supabaseClient
      .from("salary_slips")
      .delete()
      .eq("company_id", id);
    if (result.error) throw result.error;

    if (employeeIds.length) {
      result = await supabaseClient
        .from("employee_invites")
        .delete()
        .in("employee_id", employeeIds);
      if (result.error) throw result.error;

      result = await supabaseClient
        .from("employees")
        .delete()
        .in("id", employeeIds);
      if (result.error) throw result.error;
    }

    if (company.logo_path) {
      const { error: logoError } = await supabaseClient.storage
        .from(LOGO_BUCKET)
        .remove([company.logo_path]);

      if (logoError) console.warn("Logo deletion failed:", logoError.message);
    }

    result = await supabaseClient
      .from("companies")
      .delete()
      .eq("id", id);

    if (result.error) throw result.error;

    await loadCompanies();
    await loadEmployees();
    await loadSalarySlips();
    showGlobalMessage("Company and linked records deleted.", "success");
  } catch (error) {
    alert("Company deletion failed: " + (error.message || "Unknown error"));
  }
}

$("companiesTable").addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;

  try {
    if (button.dataset.editCompany) editCompany(button.dataset.editCompany);
    if (button.dataset.viewLogo) await viewCompanyLogo(button.dataset.viewLogo);

    if (button.dataset.currentCompany) {
      button.disabled = true;
      await makeCurrentCompany(button.dataset.currentCompany);
    }

    if (button.dataset.deleteCompany) await deleteCompany(button.dataset.deleteCompany);
  } catch (error) {
    alert(error.message || "Company action failed.");
  }
});

/* -------------------- EMPLOYEES -------------------- */

async function loadEmployees() {
  const { data, error } = await supabaseClient
    .from("employees")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  employees = data || [];
  renderEmployees();
  updateEmployeeCodeSuggestion();
  renderSalaryEmployeeOptions();
  renderDashboardCounts();
}

function renderEmployees() {
  const query = ($("employeeSearch").value || "").trim().toLowerCase();
  const companyFilter = $("employeeFilterCompany").value;

  const list = employees.filter(e => {
    const matchesCompany = !companyFilter || e.company_id === companyFilter;

    const matchesSearch = !query || [
      e.full_name, e.employee_code, e.email, e.department, e.designation,
      companyName(e.company_id)
    ].some(v => String(v || "").toLowerCase().includes(query));

    return matchesCompany && matchesSearch;
  });

  $("employeesTable").innerHTML = list.length
    ? list.map(e => `
      <tr>
        <td>
          <span class="primary-cell">${escapeHTML(e.full_name)}</span>
          <span class="sub-cell">${escapeHTML(e.email || "No email")}</span>
        </td>
        <td>${escapeHTML(e.employee_code || "—")}</td>
        <td>${escapeHTML(companyName(e.company_id))}</td>
        <td>${money(e.monthly_salary)}</td>
        <td>
          ${e.auth_user_id
            ? '<span class="status">Activated</span>'
            : '<span class="status pending">Not activated</span>'}
          ${!e.is_active ? '<span class="sub-cell">Inactive record</span>' : ""}
        </td>
        <td>
          <div class="actions tight">
            <button type="button" class="btn secondary small" data-edit-employee="${escapeHTML(e.id)}">Edit</button>
            ${!e.auth_user_id && e.is_active
              ? `<button type="button" class="btn small" data-generate-code="${escapeHTML(e.id)}">Generate code</button>`
              : ""}
            <button type="button" class="btn danger small" data-delete-employee="${escapeHTML(e.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="6"><div class="empty-state">
        <div class="empty-icon">♙</div>
        ${query || companyFilter ? "No employees match the selected search or filter." : "No employees added yet. Create an employee using the form below."}
      </div></td></tr>`;
}

$("employeeSearch").addEventListener("input", renderEmployees);
$("employeeFilterCompany").addEventListener("change", renderEmployees);

function resetEmployeeForm() {
  $("employeeForm").reset();
  $("employeeId").value = "";
  $("employeeFormTitle").textContent = "Add an employee";
  $("saveEmployeeBtn").textContent = "Save employee";
  $("cancelEmployeeEditBtn").hidden = true;

  if (activeCompany()) $("employeeCompany").value = activeCompany().id;

  showMessage("employeeMessage", "");
  updateEmployeeCodeSuggestion();
}

$("resetEmployeeBtn").addEventListener("click", resetEmployeeForm);
$("cancelEmployeeEditBtn").addEventListener("click", resetEmployeeForm);

$("newEmployeeBtn").addEventListener("click", () => {
  resetEmployeeForm();
  $("employeeFormPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  $("employeeName").focus();
});

function suggestEmployeeCode(companyId) {
  if (!companyId) return "";

  const companyEmployees = employees.filter(e => e.company_id === companyId);
  if (!companyEmployees.length) return "";

  const parsed = companyEmployees.map(e => {
    const match = String(e.employee_code || "").trim().match(/^(.*?)(\d+)$/);
    return match
      ? { prefix: match[1], number: Number(match[2]), width: match[2].length }
      : null;
  }).filter(Boolean);

  if (!parsed.length) return "";

  const prefixes = [...new Set(parsed.map(p => p.prefix))];

  const bestPrefix = prefixes.sort((a, b) =>
    parsed.filter(p => p.prefix === b).length -
    parsed.filter(p => p.prefix === a).length
  )[0];

  const samePrefix = parsed.filter(p => p.prefix === bestPrefix);

  const highest = samePrefix.reduce(
    (max, p) => p.number > max.number ? p : max,
    samePrefix[0]
  );

  return bestPrefix + String(highest.number + 1).padStart(highest.width, "0");
}

function updateEmployeeCodeSuggestion() {
  if ($("employeeId").value) return;

  const companyId = $("employeeCompany").value;
  const input = $("employeeCode");

  if (!companyId) {
    input.placeholder = "Select a company first";
    return;
  }

  const suggestion = suggestEmployeeCode(companyId);

  input.placeholder = suggestion
    ? `Suggested: ${suggestion}`
    : "Enter the first code, e.g. SS0001";

  if (!input.value && suggestion) input.value = suggestion;
}

$("employeeCompany").addEventListener("change", () => {
  if (!$("employeeId").value) $("employeeCode").value = "";
  updateEmployeeCodeSuggestion();
});

$("employeeForm").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("saveEmployeeBtn");
  setButtonBusy(button, true, "Saving…");
  showMessage("employeeMessage", "");

  try {
    const editId = $("employeeId").value;

    const payload = {
      company_id: $("employeeCompany").value,
      employee_code: $("employeeCode").value.trim(),
      full_name: $("employeeName").value.trim(),
      email: $("employeeEmail").value.trim().toLowerCase(),
      mobile: $("employeeMobile").value.trim() || null,
      designation: $("employeeDesignation").value.trim() || null,
      department: $("employeeDepartment").value.trim() || null,
      joining_date: $("employeeJoining").value || null,
      monthly_salary: Number($("employeeMonthly").value),
      annual_ctc: $("employeeCtc").value ? Number($("employeeCtc").value) : null,
      uan: $("employeeUan").value.trim() || null,
      esic_number: $("employeeEsic").value.trim() || null,
      is_active: true
    };

    if (!companies.some(c => c.id === payload.company_id)) {
      throw new Error("Select a valid company.");
    }

    if (!payload.employee_code || !payload.full_name || !payload.email) {
      throw new Error("Company, employee code, name and email are required.");
    }

    if (!Number.isFinite(payload.monthly_salary) || payload.monthly_salary < 0) {
      throw new Error("Enter a valid monthly salary.");
    }

    if (editId) {
      const { error } = await supabaseClient
        .from("employees")
        .update(payload)
        .eq("id", editId);

      if (error) throw error;
    } else {
      const { error } = await supabaseClient
        .from("employees")
        .insert(payload);

      if (error) {
        if (error.code === "23505") {
          throw new Error("This employee code is already used in that company, or this email already belongs to an employee.");
        }
        throw error;
      }
    }

    resetEmployeeForm();
    await loadEmployees();

    showMessage(
      "employeeMessage",
      editId
        ? "Employee updated successfully."
        : "Employee saved. Generate an activation code from the employee list when you need one.",
      "success"
    );
  } catch (error) {
    console.error(error);
    showMessage("employeeMessage", error.message || "Could not save employee.", "error");
  } finally {
    setButtonBusy(button, false);
  }
});

async function editEmployee(id) {
  const { data: employee, error } = await supabaseClient
    .from("employees")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    alert(error.message);
    return;
  }

  $("employeeId").value = employee.id;
  $("employeeCompany").value = employee.company_id;
  $("employeeCode").value = employee.employee_code || "";
  $("employeeName").value = employee.full_name || "";
  $("employeeEmail").value = employee.email || "";
  $("employeeMobile").value = employee.mobile || "";
  $("employeeDesignation").value = employee.designation || "";
  $("employeeDepartment").value = employee.department || "";
  $("employeeJoining").value = employee.joining_date || "";
  $("employeeMonthly").value = employee.monthly_salary ?? 0;
  $("employeeCtc").value = employee.annual_ctc ?? "";
  $("employeeUan").value = employee.uan || "";
  $("employeeEsic").value = employee.esic_number || "";

  $("employeeFormTitle").textContent = "Edit employee";
  $("saveEmployeeBtn").textContent = "Update employee";
  $("cancelEmployeeEditBtn").hidden = false;

  showMessage("employeeMessage", "");
  $("employeeFormPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function generateActivationCode(employeeId, button) {
  if (button) button.disabled = true;

  try {
    const { data: employee, error: employeeError } = await supabaseClient
      .from("employees")
      .select("id, full_name, auth_user_id, is_active")
      .eq("id", employeeId)
      .single();

    if (employeeError) throw employeeError;
    if (!employee.is_active) throw new Error("This employee is inactive.");
    if (employee.auth_user_id) throw new Error("This employee account is already activated.");

    const confirmed = confirm(
      `Generate a new activation code for ${employee.full_name}? Any previous unused code will be replaced.`
    );
    if (!confirmed) return;

    const { error: removeError } = await supabaseClient
      .from("employee_invites")
      .delete()
      .eq("employee_id", employeeId);

    if (removeError) throw removeError;

    const code = "EMP-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();

    const { error } = await supabaseClient
      .from("employee_invites")
      .insert({
        employee_id: employeeId,
        code_hash: await sha256(code),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        created_by: currentUser.id
      });

    if (error) throw error;

    const copyCode = prompt(
      `Activation code for ${employee.full_name}.\nIt expires in 7 days. Copy it now and share it securely with the employee:`,
      code
    );

    if (copyCode !== null) {
      try {
        await navigator.clipboard.writeText(code);
      } catch (_) {
        // The prompt still displays the code for manual copying.
      }
    }

    showGlobalMessage("Activation code generated. It will not be shown again from the database.", "success");
  } catch (error) {
    alert("Could not generate activation code: " + (error.message || "Unknown error"));
  } finally {
    if (button) button.disabled = false;
  }
}

async function deleteEmployee(id) {
  const employee = employees.find(e => e.id === id);
  if (!employee) return;

  if (!confirm(
    `Permanently delete ${employee.full_name}, including all salary slips and activation codes? This cannot be undone.`
  )) return;

  try {
    let result = await supabaseClient.from("salary_slips").delete().eq("employee_id", id);
    if (result.error) throw result.error;

    result = await supabaseClient.from("employee_invites").delete().eq("employee_id", id);
    if (result.error) throw result.error;

    result = await supabaseClient.from("employees").delete().eq("id", id);
    if (result.error) throw result.error;

    await loadEmployees();
    await loadSalarySlips();
    showGlobalMessage("Employee and linked records deleted.", "success");
  } catch (error) {
    alert("Employee deletion failed: " + (error.message || "Unknown error"));
  }
}

$("employeesTable").addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.editEmployee) {
    await editEmployee(button.dataset.editEmployee);
  }

  if (button.dataset.generateCode) {
    await generateActivationCode(button.dataset.generateCode, button);
  }

  if (button.dataset.deleteEmployee) {
    await deleteEmployee(button.dataset.deleteEmployee);
  }
});

/* -------------------- SALARY SLIP FORM -------------------- */

function addSalaryLine(containerId, label = "", amount = "") {
  const container = $(containerId);
  const row = document.createElement("div");
  row.className = "salary-line";

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "line-label";
  labelInput.placeholder = containerId === "earningsList"
    ? "Earning name (e.g. Basic Salary)"
    : "Deduction name (e.g. PF)";
  labelInput.value = label;
  labelInput.maxLength = 120;
  labelInput.required = true;
  labelInput.setAttribute("aria-label", "Salary component name");

  const amountInput = document.createElement("input");
  amountInput.type = "number";
  amountInput.className = "line-amount";
  amountInput.placeholder = "Amount ₹";
  amountInput.min = "0";
  amountInput.step = "0.01";
  amountInput.value = amount;
  amountInput.required = true;
  amountInput.setAttribute("aria-label", "Salary component amount");

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "line-remove";
  removeButton.textContent = "×";
  removeButton.setAttribute("aria-label", "Remove salary component");

  removeButton.addEventListener("click", () => {
    row.remove();
    calculateSalary();
  });

  labelInput.addEventListener("input", calculateSalary);
  amountInput.addEventListener("input", calculateSalary);

  row.append(labelInput, amountInput, removeButton);
  container.appendChild(row);
  calculateSalary();
}

function readSalaryLines(containerId) {
  return [...$(containerId).querySelectorAll(".salary-line")].map(row => ({
    name: row.querySelector(".line-label").value.trim(),
    amount: Number(row.querySelector(".line-amount").value || 0)
  }));
}

function calculateSalary() {
  const earnings = readSalaryLines("earningsList");
  const deductions = readSalaryLines("deductionsList");

  const gross = earnings.reduce((sum, item) => sum + item.amount, 0);
  const totalDeductions = deductions.reduce((sum, item) => sum + item.amount, 0);
  const net = gross - totalDeductions;

  $("grossTotal").textContent = money(gross);
  $("deductionTotal").textContent = money(totalDeductions);
  $("netTotal").textContent = money(net);

  return { earnings, deductions, gross, totalDeductions, net };
}

$("addEarningBtn").addEventListener("click", () => addSalaryLine("earningsList"));
$("addDeductionBtn").addEventListener("click", () => addSalaryLine("deductionsList"));
$("calculateBtn").addEventListener("click", calculateSalary);

function renderSalaryEmployeeOptions() {
  const companyId = $("salaryCompany").value;
  const search = ($("salaryEmployeeSearch").value || "").trim().toLowerCase();
  const select = $("salaryEmployee");
  const previous = select.value;

  const matches = employees.filter(e =>
    e.company_id === companyId &&
    e.is_active !== false &&
    (!search ||
      (e.full_name || "").toLowerCase().includes(search) ||
      (e.employee_code || "").toLowerCase().includes(search) ||
      (e.email || "").toLowerCase().includes(search))
  );

  select.innerHTML = '<option value="">Select employee</option>' + matches.map(e =>
    `<option value="${escapeHTML(e.id)}">${escapeHTML(e.full_name)} · ${escapeHTML(e.employee_code || "No code")}</option>`
  ).join("");

  if (matches.some(e => e.id === previous)) select.value = previous;

  renderSalaryEmployeeSummary();
}

function renderSalaryEmployeeSummary() {
  const employee = employees.find(e => e.id === $("salaryEmployee").value);

  $("salaryEmployeeSummary").innerHTML = employee
    ? `<strong>${escapeHTML(employee.full_name)}</strong><br>
       Employee code: ${escapeHTML(employee.employee_code || "—")}<br>
       Designation: ${escapeHTML(employee.designation || "—")}<br>
       Department: ${escapeHTML(employee.department || "—")}<br>
       Monthly salary: <strong>${money(employee.monthly_salary)}</strong>`
    : "Select an employee to view their details.";
}

$("salaryCompany").addEventListener("change", () => {
  const company = companies.find(c => c.id === $("salaryCompany").value);

  if (company) {
    $("salaryCurrentCompanyName").textContent = company.name;
    $("salaryCurrentCompanyDetails").textContent =
      `${company.address || "Address not added"} · GSTIN: ${company.gstin || "—"} · TAN: ${company.tan || "—"}`;
  } else {
    renderCurrentCompany();
  }

  $("salaryEmployeeSearch").value = "";
  renderSalaryEmployeeOptions();
});

$("salaryEmployeeSearch").addEventListener("input", renderSalaryEmployeeOptions);
$("salaryEmployee").addEventListener("change", renderSalaryEmployeeSummary);

function resetSalaryForm() {
  $("salaryForm").reset();
  $("earningsList").innerHTML = "";
  $("deductionsList").innerHTML = "";

  addSalaryLine("earningsList", "Basic Salary", "");
  addSalaryLine("deductionsList", "PF", "");

  $("salaryMonth").value = new Date().toISOString().slice(0, 7);
  $("salaryEmployeeSearch").value = "";

  if (activeCompany()) $("salaryCompany").value = activeCompany().id;

  renderSalaryEmployeeOptions();
  calculateSalary();
  showMessage("salaryMessage", "");
}

$("resetSalaryBtn").addEventListener("click", resetSalaryForm);

$("salaryForm").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("saveSalaryBtn");
  setButtonBusy(button, true, "Saving slip…");
  showMessage("salaryMessage", "");

  try {
    const companyId = $("salaryCompany").value;
    const employeeId = $("salaryEmployee").value;
    const month = $("salaryMonth").value;

    const company = companies.find(c => c.id === companyId);
    const employee = employees.find(e => e.id === employeeId);

    if (!company) throw new Error("Select a company.");

    if (!employee || employee.company_id !== companyId) {
      throw new Error("Select an employee belonging to the selected company.");
    }

    if (!month) throw new Error("Select the salary month.");

    const totals = calculateSalary();

    if (!totals.earnings.length || totals.earnings.some(x => !x.name)) {
      throw new Error("Enter a name for every earning.");
    }

    if (totals.deductions.some(x => !x.name)) {
      throw new Error("Enter a name for every deduction.");
    }

    if (
      totals.earnings.some(x => !Number.isFinite(x.amount) || x.amount < 0) ||
      totals.deductions.some(x => !Number.isFinite(x.amount) || x.amount < 0)
    ) {
      throw new Error("Salary amounts cannot be negative or invalid.");
    }

    if (totals.net < 0) {
      throw new Error("Total deductions cannot exceed total earnings.");
    }

    const companySnapshot = {
      company_name: company.name,
      full_address: company.address,
      gstin: company.gstin,
      tan: company.tan,
      logo_path: company.logo_path || null,
      logo_url: company.logo_path ? logoPublicUrl(company.logo_path) : null
    };

    const employeeSnapshot = {
      employee_code: employee.employee_code,
      full_name: employee.full_name,
      email: employee.email,
      mobile: employee.mobile,
      designation: employee.designation,
      department: employee.department,
      joining_date: employee.joining_date,
      uan: employee.uan,
      esic_number: employee.esic_number
    };

    const payload = {
      company_id: company.id,
      employee_id: employee.id,
      salary_month: `${month}-01`,
      payment_date: $("salaryPaymentDate").value || null,
      earnings: totals.earnings,
      deductions: totals.deductions,
      gross_salary: totals.gross,
      total_deductions: totals.totalDeductions,
      net_salary: totals.net,
      company_snapshot: companySnapshot,
      employee_snapshot: employeeSnapshot,
      payment_mode: $("salaryPaymentMode").value || null,
      remarks: $("salaryRemarks").value.trim() || null,
      status: "finalized",
      created_by: currentUser.id
    };

    const { data, error } = await supabaseClient
      .from("salary_slips")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new Error("A salary slip already exists for this employee and month.");
      }
      throw error;
    }

    await loadSalarySlips();
    await renderDashboardCounts();

    // Saving a slip must NOT trigger an automatic PDF download.
    resetSalaryForm();

    showMessage(
      "salaryMessage",
      `Salary slip for ${employee.full_name} (${monthLabel(data.salary_month)}) saved successfully. Open Saved Salary Slips to download the PDF.`,
      "success"
    );
  } catch (error) {
    console.error(error);
    showMessage("salaryMessage", error.message || "Could not save salary slip.", "error");
  } finally {
    setButtonBusy(button, false);
  }
});

/* -------------------- SAVED SALARY SLIPS -------------------- */

async function loadSalarySlips() {
  const { data, error } = await supabaseClient
    .from("salary_slips")
    .select("*")
    .order("salary_month", { ascending: false });

  if (error) throw error;

  salarySlips = data || [];
  renderSalarySlips();
  renderDashboardCounts();
}

function renderSalarySlips() {
  const companyId = $("slipFilterCompany").value;
  const month = $("slipFilterMonth").value;

  const list = salarySlips.filter(s => {
    const matchesCompany = !companyId || s.company_id === companyId;
    const matchesMonth = !month || String(s.salary_month || "").startsWith(month);
    return matchesCompany && matchesMonth;
  });

  $("slipsTable").innerHTML = list.length
    ? list.map(s => `
      <tr>
        <td>
          <span class="primary-cell">${escapeHTML(monthLabel(s.salary_month))}</span>
          <span class="sub-cell">${escapeHTML(s.payment_date || "Payment date not set")}</span>
        </td>
        <td>
          <span class="primary-cell">${escapeHTML(s.employee_snapshot?.full_name || "Employee")}</span>
          <span class="sub-cell">${escapeHTML(s.employee_snapshot?.employee_code || "")}</span>
        </td>
        <td>${escapeHTML(s.company_snapshot?.company_name || companyName(s.company_id))}</td>
        <td><strong>${money(s.net_salary)}</strong></td>
        <td><span class="status">${escapeHTML(s.status || "finalized")}</span></td>
        <td>
          <button type="button" class="btn small" data-download-slip="${escapeHTML(s.id)}">↓ Download PDF</button>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="6"><div class="empty-state">
        <div class="empty-icon">▤</div>
        ${companyId || month ? "No saved salary slips match these filters." : "No salary slips saved yet. Create a slip from Salary Slip Creation."}
      </div></td></tr>`;
}

$("slipFilterCompany").addEventListener("change", renderSalarySlips);
$("slipFilterMonth").addEventListener("change", renderSalarySlips);

$("clearSlipFiltersBtn").addEventListener("click", () => {
  $("slipFilterCompany").value = "";
  $("slipFilterMonth").value = "";
  renderSalarySlips();
});

$("slipsTable").addEventListener("click", async event => {
  const button = event.target.closest("[data-download-slip]");
  if (!button) return;

  const slip = salarySlips.find(s => s.id === button.dataset.downloadSlip);
  if (!slip) return;

  setButtonBusy(button, true, "Preparing…");

  try {
    await downloadSlipPDF(slip);
  } catch (error) {
    console.error(error);
    alert("PDF generation failed: " + (error.message || "Unknown error"));
  } finally {
    setButtonBusy(button, false);
  }
});

/* -------------------- PDF HELPERS -------------------- */

async function getLogoAsDataURL(company) {
  let url = company?.logo_url || null;

  if (company?.logo_path) {
    url = logoPublicUrl(company.logo_path);
  }

  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok) throw new Error("Company logo could not be loaded.");

  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function addImageProportionally(doc, dataUrl, x, y, maxWidth, maxHeight) {
  const properties = doc.getImageProperties(dataUrl);
  const ratio = Math.min(
    maxWidth / properties.width,
    maxHeight / properties.height
  );

  const width = properties.width * ratio;
  const height = properties.height * ratio;

  doc.addImage(
    dataUrl,
    properties.fileType || "PNG",
    x + (maxWidth - width) / 2,
    y + (maxHeight - height) / 2,
    width,
    height
  );
}

/* Convert a number to Indian currency words. */
function numberToIndianWords(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number) || number < 0) {
    return "Zero Rupees Only";
  }

  const whole = Math.floor(number);
  const paise = Math.round((number - whole) * 100);

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
    "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
    "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen",
    "Nineteen"
  ];

  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty",
    "Sixty", "Seventy", "Eighty", "Ninety"
  ];

  function underThousand(n) {
    let result = "";

    if (n >= 100) {
      result += ones[Math.floor(n / 100)] + " Hundred ";
      n %= 100;
    }

    if (n >= 20) {
      result += tens[Math.floor(n / 10)] + " ";
      n %= 10;
    }

    if (n > 0) result += ones[n] + " ";

    return result;
  }

  function indianWords(n) {
    if (n === 0) return "Zero";

    const parts = [];

    const crore = Math.floor(n / 10000000);
    n %= 10000000;

    const lakh = Math.floor(n / 100000);
    n %= 100000;

    const thousand = Math.floor(n / 1000);
    n %= 1000;

    const remainder = n;

    if (crore) parts.push(underThousand(crore) + "Crore");
    if (lakh) parts.push(underThousand(lakh) + "Lakh");
    if (thousand) parts.push(underThousand(thousand) + "Thousand");
    if (remainder) parts.push(underThousand(remainder));

    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  let result = indianWords(whole) + " Rupees";

  if (paise > 0) {
    result += " and " + indianWords(paise) + " Paise";
  }

  return result + " Only";
}

/* -------------------- PROFESSIONAL MONOCHROME PDF -------------------- */

async function downloadSlipPDF(slip) {
  if (!window.jspdf?.jsPDF) {
    throw new Error("PDF library did not load. Check your internet connection.");
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const company = slip.company_snapshot || {};
  const employee = slip.employee_snapshot || {};
  const earnings = Array.isArray(slip.earnings) ? slip.earnings : [];
  const deductions = Array.isArray(slip.deductions) ? slip.deductions : [];

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const left = 14;
  const right = pageWidth - 14;
  const center = pageWidth / 2;
  const width = right - left;

  const ink = [0, 0, 0];
  const grey = [95, 95, 95];
  const border = [125, 125, 125];
  const lightBorder = [190, 190, 190];
  const pale = [244, 244, 244];

  let y = 10;

  function setInk() {
    doc.setTextColor(...ink);
    doc.setDrawColor(...border);
  }

  function line(x1, y1, x2, y2, color = border, thickness = 0.25) {
    doc.setDrawColor(...color);
    doc.setLineWidth(thickness);
    doc.line(x1, y1, x2, y2);
  }

  function text(value, x, yy, options = {}) {
    doc.text(String(value ?? ""), x, yy, options);
  }

  function wrapped(value, maxWidth, fontSize = 8.5) {
    doc.setFontSize(fontSize);
    return doc.splitTextToSize(String(value || "—"), maxWidth);
  }

  function ensureSpace(requiredHeight) {
    if (y + requiredHeight > pageHeight - 17) {
      doc.addPage();
      y = 15;
    }
  }

  function drawSectionTitle(title) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setInk();
    text(title.toUpperCase(), left, y + 4.5);
    line(left, y + 6.5, right, y + 6.5, ink, 0.35);
    y += 9;
  }

  function drawLabelValue(label, value, x, yy, maxWidth) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    setInk();

    const labelWidth = doc.getTextWidth(label);
    text(label, x, yy);

    const valueLines = wrapped(value || "—", maxWidth - labelWidth, 8.2);
    text(valueLines, x + labelWidth + 1, yy);

    return Math.max(1, valueLines.length) * 4.2;
  }

  /* Company logo — approximately 10% larger than the old frame. */
  try {
    const logo = await getLogoAsDataURL(company);

    if (logo) {
      addImageProportionally(
        doc,
        logo,
        center - 20.6,
        y,
        41.2,
        27.5
      );
      y += 30;
    }
  } catch (error) {
    console.warn("Company logo was not included:", error.message);
  }

  /* Company name and address are centred on the page. */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  setInk();

  const companyNameLines = wrapped(
    company.company_name || "Company Name",
    width - 8,
    16
  );

  text(companyNameLines, center, y + 5, { align: "center" });
  y += companyNameLines.length * 6 + 1;

  if (company.full_address) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...grey);

    const addressLines = wrapped(
      String(company.full_address).replace(/\s+/g, " ").trim(),
      width - 12,
      8.5
    );

    text(addressLines, center, y + 2, { align: "center" });
    y += addressLines.length * 4 + 2;
  }

  const taxDetails = [];
  if (company.gstin) taxDetails.push("GSTIN: " + company.gstin);
  if (company.tan) taxDetails.push("TAN: " + company.tan);

  if (taxDetails.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...grey);

    taxDetails.forEach(detail => {
      text(detail, center, y + 2, { align: "center" });
      y += 4;
    });
  }

  y += 3;
  line(left, y, right, y, ink, 0.6);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  setInk();
  text("SALARY SLIP", center, y, { align: "center" });
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  text("Salary Period: " + monthLabel(slip.salary_month), center, y, {
    align: "center"
  });
  y += 6;

  line(left, y, right, y, ink, 0.35);
  y += 4;

  /* Employee details in a compact bordered block. */
  drawSectionTitle("Employee Details");

  const detailTop = y;
  const detailRowHeight = 8;
  const mid = center;

  const employeeRows = [
    ["Employee Name", employee.full_name || "—", "Employee Code", employee.employee_code || "—"],
    ["Designation", employee.designation || "—", "Department", employee.department || "—"],
    ["Date of Joining", employee.joining_date || "—", "Payment Date", slip.payment_date || "—"],
    ["UAN", employee.uan || "—", "ESIC Number", employee.esic_number || "—"]
  ];

  const detailHeight = employeeRows.length * detailRowHeight;

  doc.setDrawColor(...border);
  doc.setLineWidth(0.25);
  doc.rect(left, detailTop, width, detailHeight);

  line(mid, detailTop, mid, detailTop + detailHeight, lightBorder, 0.25);

  employeeRows.forEach((row, index) => {
    const rowY = detailTop + index * detailRowHeight;

    if (index > 0) {
      line(left, rowY, right, rowY, lightBorder, 0.2);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.6);
    setInk();

    text(row[0] + ":", left + 2, rowY + 5);
    text(row[2] + ":", mid + 2, rowY + 5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);

    const firstLabelWidth = Math.min(doc.getTextWidth(row[0] + ":") + 2, 27);
    const secondLabelWidth = Math.min(doc.getTextWidth(row[2] + ":") + 2, 27);

    const firstValue = wrapped(row[1], width / 2 - firstLabelWidth - 5, 7.8);
    const secondValue = wrapped(row[3], width / 2 - secondLabelWidth - 5, 7.8);

    text(firstValue, left + firstLabelWidth + 3, rowY + 5);
    text(secondValue, mid + secondLabelWidth + 3, rowY + 5);
  });

  y += detailHeight + 7;

  /* Side-by-side earnings and deductions table. */
  ensureSpace(30);

  const gap = 4;
  const halfWidth = (width - gap) / 2;
  const earningsX = left;
  const deductionsX = left + halfWidth + gap;

  function drawCompactTable(title, rows, totalLabel, totalValue, x, tableWidth) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setInk();
    text(title, x, y);

    const tableTop = y + 3;
    const headerHeight = 7;
    const labelWidth = tableWidth - 23;

    doc.setFillColor(238, 238, 238);
    doc.rect(x, tableTop, tableWidth, headerHeight, "F");
    doc.setDrawColor(...border);
    doc.rect(x, tableTop, tableWidth, headerHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    text("DESCRIPTION", x + 2, tableTop + 4.6);
    text("AMOUNT", x + tableWidth - 2, tableTop + 4.6, { align: "right" });

    let rowY = tableTop + headerHeight;
    const actualRows = rows.length ? rows : [{ name: "—", amount: 0 }];

    actualRows.forEach(item => {
      const descriptionLines = wrapped(item.name || "—", labelWidth - 3, 7.2);
      const rowHeight = Math.max(7, descriptionLines.length * 3.5 + 3);

      if (rowY + rowHeight > pageHeight - 35) {
        doc.addPage();
        rowY = 18;
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      setInk();

      text(descriptionLines, x + 2, rowY + 4.5);
      text(
        Number(item.amount || 0).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }),
        x + tableWidth - 2,
        rowY + 4.5,
        { align: "right" }
      );

      line(x, rowY + rowHeight, x + tableWidth, rowY + rowHeight, lightBorder, 0.2);
      rowY += rowHeight;
    });

    const totalHeight = 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    setInk();

    doc.setFillColor(246, 246, 246);
    doc.rect(x, rowY, tableWidth, totalHeight, "F");
    doc.setDrawColor(...border);
    doc.rect(x, rowY, tableWidth, totalHeight);

    const shortLabel = totalLabel;
    text(shortLabel, x + 2, rowY + 5);
    text(
      Number(totalValue || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
      x + tableWidth - 2,
      rowY + 5,
      { align: "right" }
    );

    return rowY + totalHeight;
  }

  const earningsBottom = drawCompactTable(
    "EARNINGS",
    earnings,
    "GROSS",
    slip.gross_salary,
    earningsX,
    halfWidth
  );

  const deductionsBottom = drawCompactTable(
    "DEDUCTIONS",
    deductions,
    "TOTAL",
    slip.total_deductions,
    deductionsX,
    halfWidth
  );

  y = Math.max(earningsBottom, deductionsBottom) + 8;

  /* Net salary summary — monochrome, no coloured backgrounds. */
  ensureSpace(22);

  doc.setDrawColor(...ink);
  doc.setLineWidth(0.6);
  doc.rect(left, y, width, 14);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setInk();

  text("NET SALARY PAYABLE", left + 4, y + 8.5);

  doc.setFontSize(12);
  text(
    "INR " + Number(slip.net_salary || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }),
    right - 4,
    y + 8.5,
    { align: "right" }
  );

  y += 19;

  /* Amount in words. */
  ensureSpace(17);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setInk();
  text("Amount in Words:", left, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  const words = numberToIndianWords(slip.net_salary);
  const wordsLines = wrapped(words, width - 29, 8);

  text(wordsLines, left + 29, y);
  y += Math.max(6, wordsLines.length * 4) + 3;

  /* Optional payment information and remarks. */
  if (slip.payment_mode || slip.remarks) {
    ensureSpace(15);

    line(left, y, right, y, lightBorder, 0.25);
    y += 5;

    if (slip.payment_mode) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      text("Payment Mode:", left, y);

      doc.setFont("helvetica", "normal");
      text(String(slip.payment_mode), left + 25, y);
      y += 5;
    }

    if (slip.remarks) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      text("Remarks:", left, y);
      y += 4;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);

      const remarksLines = wrapped(slip.remarks, width, 8);
      text(remarksLines, left, y);
      y += remarksLines.length * 4 + 2;
    }
  }

  /* Authorised signatory section. */
  ensureSpace(27);

  const signatureWidth = 55;
  const signatureX = right - signatureWidth;

  line(signatureX, y + 12, right, y + 12, ink, 0.35);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setInk();

  text("Authorised Signatory", right - signatureWidth / 2, y + 17, {
    align: "center"
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  text("For " + String(company.company_name || "Company"), right - signatureWidth / 2, y + 21, {
    align: "center"
  });

  y += 27;

  /* Footer on every page. */
  const pageCount = doc.internal.getNumberOfPages();

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);

    line(left, pageHeight - 13, right, pageHeight - 13, lightBorder, 0.25);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...grey);

    text("Computer-generated salary slip", left, pageHeight - 8);
    text(`${page} / ${pageCount}`, right, pageHeight - 8, { align: "right" });
  }

  const safeName = String(employee.full_name || "Employee")
    .replace(/[^a-z0-9_-]/gi, "_");

  const safeMonth = String(slip.salary_month || "unknown").slice(0, 7);

  doc.save(`SalarySlip_${safeName}_${safeMonth}.pdf`);
}

/* -------------------- DASHBOARD COUNTS -------------------- */

function renderDashboardCounts() {
  $("companyCount").textContent = companies.length;
  $("employeeCount").textContent = employees.filter(e => e.is_active !== false).length;
  $("slipCount").textContent = salarySlips.length;
}

/* -------------------- INITIAL LOAD -------------------- */

(async function init() {
  try {
    const ok = await requireAdmin();
    if (!ok) return;

    await loadCompanies();
    await loadEmployees();
    await loadSalarySlips();

    resetCompanyForm();
    resetEmployeeForm();
    resetSalaryForm();

    renderDashboardCounts();
    navigate("overview");
  } catch (error) {
    console.error("Admin dashboard initialisation failed:", error);

    showGlobalMessage(
      "Dashboard load nahi ho paya: " + (error.message || "Unknown error"),
      "error"
    );
  }
})();
