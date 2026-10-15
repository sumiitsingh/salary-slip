/* =========================================================
   SALARY PORTAL — EMPLOYEE DASHBOARD
   Complete replacement: employee-dashboard.js

   Requires:
   - Existing global Supabase client: supabaseClient
   - jsPDF UMD library: window.jspdf.jsPDF
   - Tables: employees, companies, salary_slips
   - Storage bucket: company-logos
   ========================================================= */

"use strict";

/* -------------------- CONFIGURATION -------------------- */

const LOGO_BUCKET = "company-logos";

let currentUser = null;
let employee = null;
let company = null;
let salarySlips = [];
let selectedSlipIds = new Set();

let dashboardInitialized = false;
let dashboardLoading = false;

/* -------------------- GENERAL HELPERS -------------------- */

function $(id) {
  return document.getElementById(id);
}

function safe(value, fallback = "—") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value);
}

function firstValue(...values) {
  return values.find(
    value => value !== null &&
      value !== undefined &&
      String(value).trim() !== ""
  ) ?? "—";
}

function display(id, value, fallback = "—") {
  const element = $(id);
  if (element) element.textContent = safe(value, fallback);
}

function showMessage(message, type = "info") {
  const candidates = [
    "dashboardMessage",
    "messageBox",
    "statusMessage",
    "errorMessage",
    "message"
  ];

  let element = candidates.map($).find(Boolean);

  if (!element) {
    element = document.createElement("div");
    element.id = "dashboardMessage";
    element.setAttribute("role", "status");
    element.style.cssText =
      "margin:12px 0;padding:10px 14px;border-radius:6px;" +
      "font-size:14px;white-space:pre-wrap;";

    const main = $("dashboardContent") ||
      $("dashboard") ||
      $("slipsTable")?.parentElement ||
      document.body;

    main.prepend(element);
  }

  element.textContent = message || "";
  element.style.display = message ? "block" : "none";

  const colors = {
    info: ["#eff6ff", "#1d4ed8"],
    success: ["#f0fdf4", "#166534"],
    error: ["#fef2f2", "#b91c1c"],
    warning: ["#fffbeb", "#92400e"]
  };

  const color = colors[type] || colors.info;
  element.style.backgroundColor = color[0];
  element.style.color = color[1];
}

function money(value) {
  const number = Number(value || 0);

  return number.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function amount(value) {
  return money(value);
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatMonth(value) {
  if (!value) return "—";

  const match = String(value).match(/^(\d{4})-(\d{2})/);

  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      1
    );

    return date.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric"
    });
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric"
  });
}

function parseSnapshot(value) {
  if (!value) return {};

  if (typeof value === "object") {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeRows(value) {
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === "string") {
        return { name: item, amount: 0 };
      }

      return {
        ...item,
        name: firstValue(
          item?.name,
          item?.label,
          item?.title,
          "—"
        ),
        amount: Number(item?.amount ?? item?.value ?? 0)
      };
    });
  }

  return [];
}

/* -------------------- INDIAN NUMBER WORDS -------------------- */

function numberToIndianWords(input) {
  const number = Math.round(Number(input || 0) * 100) / 100;

  if (!Number.isFinite(number)) return "Zero Rupees Only";

  if (number < 0) {
    return "Minus " +
      numberToIndianWords(Math.abs(number));
  }

  const ones = [
    "", "One", "Two", "Three", "Four", "Five",
    "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen",
    "Fifteen", "Sixteen", "Seventeen", "Eighteen",
    "Nineteen"
  ];

  const tens = [
    "", "", "Twenty", "Thirty", "Forty",
    "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
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

    if (n > 0) {
      result += ones[n] + " ";
    }

    return result.trim();
  }

  function integerWords(n) {
    if (n === 0) return "Zero";

    const groups = [
      [10000000, "Crore"],
      [100000, "Lakh"],
      [1000, "Thousand"],
      [1, ""]
    ];

    let result = "";

    for (const [divisor, label] of groups) {
      if (n >= divisor) {
        const count = Math.floor(n / divisor);

        result += underThousand(count) + " ";

        if (label) result += label + " ";

        n %= divisor;
      }
    }

    return result.trim();
  }

  const rupees = Math.floor(number);
  const paise = Math.round((number - rupees) * 100);

  let result = integerWords(rupees) + " Rupees";

  if (paise > 0) {
    result += " and " + integerWords(paise) + " Paise";
  }

  return result + " Only";
}

/* -------------------- COMPANY LOGO -------------------- */

async function getCompanyLogoUrl(companyData) {
  const data = companyData || {};

  if (data.logo_url) return data.logo_url;

  if (!data.logo_path) return null;

  const { data: publicData } = supabaseClient.storage
    .from(LOGO_BUCKET)
    .getPublicUrl(data.logo_path);

  if (publicData?.publicUrl) {
    return publicData.publicUrl;
  }

  const { data: signedData, error } = await supabaseClient.storage
    .from(LOGO_BUCKET)
    .createSignedUrl(data.logo_path, 300);

  if (error) {
    throw new Error("Company logo could not be accessed.");
  }

  return signedData?.signedUrl || null;
}

async function logoAsPng(companyData) {
  const url = await getCompanyLogoUrl(companyData);

  if (!url) return null;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Company logo could not be downloaded.");
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not process company logo.");
    }

    context.drawImage(bitmap, 0, 0);

    return {
      data: canvas.toDataURL("image/png"),
      width: bitmap.width,
      height: bitmap.height
    };
  } finally {
    bitmap.close();
  }
}

function addLogo(doc, logo, x, y, maxWidth, maxHeight) {
  const scale = Math.min(
    maxWidth / logo.width,
    maxHeight / logo.height
  );

  const width = logo.width * scale;
  const height = logo.height * scale;

  doc.addImage(
    logo.data,
    "PNG",
    x + (maxWidth - width) / 2,
    y + (maxHeight - height) / 2,
    width,
    height
  );
}

/* -------------------- SNAPSHOT HELPERS -------------------- */

function getSlipCompany(slip) {
  const snapshot = parseSnapshot(slip.company_snapshot);

  return {
    company_name: firstValue(
      snapshot.company_name,
      snapshot.name,
      company?.company_name,
      ""
    ),
    name: firstValue(
      snapshot.company_name,
      snapshot.name,
      company?.company_name,
      ""
    ),
    full_address: firstValue(
      snapshot.full_address,
      snapshot.address,
      company?.full_address,
      ""
    ),
    address: firstValue(
      snapshot.full_address,
      snapshot.address,
      company?.full_address,
      ""
    ),
    gstin: firstValue(
      snapshot.gstin,
      company?.gstin,
      ""
    ),
    tan: firstValue(
      snapshot.tan,
      company?.tan,
      ""
    ),
    logo_path: firstValue(
      snapshot.logo_path,
      company?.logo_path,
      ""
    ),
    logo_url: firstValue(
      snapshot.logo_url,
      company?.logo_url,
      ""
    )
  };
}

function getSlipEmployee(slip) {
  const snapshot = parseSnapshot(slip.employee_snapshot);

  return {
    name: firstValue(
      snapshot.full_name,
      snapshot.name,
      employee?.full_name
    ),
    code: firstValue(
      snapshot.employee_code,
      snapshot.code,
      employee?.employee_code
    ),
    designation: firstValue(
      snapshot.designation,
      employee?.designation
    ),
    department: firstValue(
      snapshot.department,
      employee?.department
    ),
    joiningDate: firstValue(
      snapshot.joining_date,
      snapshot.joiningDate,
      employee?.joining_date
    ),
    uan: firstValue(
      snapshot.uan,
      employee?.uan
    ),
    esic: firstValue(
      snapshot.esic_number,
      snapshot.esic,
      employee?.esic_number
    )
  };
}

/* -------------------- DASHBOARD RENDERING -------------------- */

async function renderCompanyDetails() {
  if (!company) return;
display("companyName", company.company_name || company.name || "");
display("companyAddress", company.full_address || "");
display("companyGSTIN", company.gstin || "");
display("companyTAN", company.tan || "");

  const logoElement = $("companyLogo");

  if (!logoElement) return;

  logoElement.style.display = "none";

  try {
    const url = await getCompanyLogoUrl(company);

    if (url) {
      logoElement.src = url;
      logoElement.alt = company.company_name || "Company logo";
      logoElement.style.display = "block";

      logoElement.onerror = () => {
        logoElement.style.display = "none";
      };
    }
  } catch (error) {
    console.warn("Dashboard company logo unavailable:", error);
  }
}

function renderEmployeeDetails() {
  if (!employee) return;

  display("employeeName", employee.full_name);
  display("employeeCode", employee.employee_code);
  display("employeeDesignation", employee.designation);
  display("employeeDepartment", employee.department);
  display("employeeJoiningDate", formatDate(employee.joining_date));

  display("employeeEmail", employee.email);
  display("employeeMobile", employee.mobile);
  display("employeeUan", employee.uan);
  display("employeeEsic", employee.esic_number);
}

function getSlipCompanyName(slip) {
  const slipCompany = getSlipCompany(slip);
  return slipCompany.company_name || "Company";
}

function renderSalarySlips() {
  const table = $("slipsTable");

  if (!table) {
    throw new Error(
      'HTML element with id="slipsTable" was not found.'
    );
  }

  table.innerHTML = "";

  if (!salarySlips.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 7;
    cell.textContent = "No salary slips available.";
    cell.style.textAlign = "center";
    cell.style.padding = "18px";

    row.appendChild(cell);
    table.appendChild(row);

    selectedSlipIds.clear();
    updateSelectionButtons();
    return;
  }

  for (const slip of salarySlips) {
    const row = document.createElement("tr");

    const checkboxCell = document.createElement("td");
    const checkbox = document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.className = "slip-select";
    checkbox.dataset.slipId = String(slip.id);
    checkbox.checked = selectedSlipIds.has(String(slip.id));
    checkbox.setAttribute(
      "aria-label",
      "Select salary slip for " + formatMonth(slip.salary_month)
    );

    checkboxCell.appendChild(checkbox);
    row.appendChild(checkboxCell);

    const values = [
      formatMonth(slip.salary_month),
      formatDate(slip.payment_date),
      money(slip.gross_salary),
      money(slip.total_deductions),
      money(slip.net_salary)
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    const actionCell = document.createElement("td");
    const button = document.createElement("button");

    button.type = "button";
    button.className = "single-download";
    button.dataset.slipId = String(slip.id);
    button.textContent = "Download PDF";

    actionCell.appendChild(button);
    row.appendChild(actionCell);

    table.appendChild(row);
  }

  updateSelectionButtons();
}

/* -------------------- LOAD EMPLOYEE PROFILE -------------------- */

async function loadMyProfile() {
  const { data: authData, error: authError } =
    await supabaseClient.auth.getUser();

  if (authError) {
    throw new Error("Could not verify your login: " + authError.message);
  }

  currentUser = authData?.user || null;

  if (!currentUser) {
    window.location.replace("login.html");
    return false;
  }

  const { data: employeeData, error: employeeError } =
    await supabaseClient
      .from("employees")
      .select("*")
      .eq("auth_user_id", currentUser.id)
      .maybeSingle();

  if (employeeError) {
    console.error("Employee profile query failed:", employeeError);

    throw new Error(
      "Employee profile could not be loaded. " +
      employeeError.message
    );
  }

  if (!employeeData) {
    throw new Error(
      "No employee record is linked to this login. " +
      "Please ask your administrator to check the employee account."
    );
  }

  employee = employeeData;

  if (!employee.company_id) {
    throw new Error(
      "Your employee account has no linked company. " +
      "Please contact your administrator."
    );
  }

  const { data: companyData, error: companyError } =
    await supabaseClient
      .from("companies")
      .select("*")
      .eq("id", employee.company_id)
      .maybeSingle();

  if (companyError) {
    console.error("Company query failed:", companyError);

    throw new Error(
      "Company details could not be loaded. " +
      companyError.message
    );
  }

  if (!companyData) {
    throw new Error(
      "The company linked to your employee account was not found."
    );
  }

  company = companyData;

  renderEmployeeDetails();
  await renderCompanyDetails();

  return true;
}

/* -------------------- LOAD SALARY SLIPS -------------------- */

async function loadMySalarySlips() {
  if (!employee?.id) {
    throw new Error(
      "Employee profile is not available. Salary slips cannot be loaded."
    );
  }

  const { data, error } = await supabaseClient
    .from("salary_slips")
    .select("*")
    .eq("employee_id", employee.id)
    .order("salary_month", { ascending: false });

  if (error) {
    console.error("Salary slip query failed:", error);

    throw new Error(
      "Salary slips could not be loaded. " + error.message
    );
  }

  /* Keep only this employee's slips for the linked company. */
  salarySlips = (data || []).filter(slip => {
    if (String(slip.employee_id) !== String(employee.id)) {
      return false;
    }

    if (
      slip.company_id &&
      String(slip.company_id) !== String(employee.company_id)
    ) {
      return false;
    }

    return true;
  });

  const validIds = new Set(salarySlips.map(slip => String(slip.id)));

  selectedSlipIds = new Set(
    [...selectedSlipIds].filter(id => validIds.has(id))
  );

  renderSalarySlips();
}

/* -------------------- PDF TEXT HELPERS -------------------- */

function splitLines(doc, value, width, fontSize = 8) {
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(
    String(value || "—"),
    width
  );
}

/* -------------------- RENDER ONE SLIP ON ONE PAGE -------------------- */

async function renderSalarySlipPage(doc, slip, logoCache) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const left = margin;
  const right = pageWidth - margin;
  const center = pageWidth / 2;
  const width = right - left;

  const ink = [0, 0, 0];
  const grey = [95, 95, 95];
  const border = [125, 125, 125];
  const lightBorder = [190, 190, 190];

  const slipCompany = getSlipCompany(slip);
  const slipEmployee = getSlipEmployee(slip);
  const earnings = normalizeRows(slip.earnings);
  const deductions = normalizeRows(slip.deductions);

  let y = 10;

  function line(x1, y1, x2, y2, color = border, thickness = 0.25) {
    doc.setDrawColor(...color);
    doc.setLineWidth(thickness);
    doc.line(x1, y1, x2, y2);
  }

  function write(value, x, yy, options = {}) {
    doc.text(String(value ?? ""), x, yy, options);
  }

  function wrapped(value, maxWidth, fontSize = 8.5) {
    return splitLines(doc, value, maxWidth, fontSize);
  }

  function sectionTitle(title) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...ink);

    write(title.toUpperCase(), left, y + 4.5);
    line(left, y + 6.5, right, y + 6.5, ink, 0.35);

    y += 9;
  }

  /* Logo */
  const logoKey = [
    slipCompany.logo_url || "",
    slipCompany.logo_path || ""
  ].join("|");

  if (!logoCache.has(logoKey)) {
    let logo = null;

    if (slipCompany.logo_url || slipCompany.logo_path) {
      try {
        logo = await logoAsPng(slipCompany);
      } catch (error) {
        console.warn("PDF logo unavailable:", error.message);
      }
    }

    logoCache.set(logoKey, logo);
  }

  const logo = logoCache.get(logoKey);

  if (logo) {
    addLogo(doc, logo, center - 20.6, y, 41.2, 27.5);
    y += 30;
  }

  /* Company heading */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...ink);

  const companyName = slipCompany.company_name || "Company Name";
  const companyLines = wrapped(companyName, width - 8, 16);

  write(companyLines, center, y + 5, { align: "center" });
  y += companyLines.length * 6 + 1;

  if (slipCompany.full_address && slipCompany.full_address !== "—") {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...grey);

    const addressLines = wrapped(
      slipCompany.full_address.replace(/\s+/g, " ").trim(),
      width - 12,
      8.5
    );

    write(addressLines, center, y + 2, { align: "center" });
    y += addressLines.length * 4 + 2;
  }

  const taxDetails = [];

  if (slipCompany.gstin && slipCompany.gstin !== "—") {
    taxDetails.push("GSTIN: " + slipCompany.gstin);
  }

  if (slipCompany.tan && slipCompany.tan !== "—") {
    taxDetails.push("TAN: " + slipCompany.tan);
  }

  for (const detail of taxDetails) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...grey);

    write(detail, center, y + 2, { align: "center" });
    y += 4;
  }

  y += 3;
  line(left, y, right, y, ink, 0.6);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...ink);

  write("SALARY SLIP", center, y, { align: "center" });
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  write(
    "Salary Period: " + formatMonth(slip.salary_month),
    center,
    y,
    { align: "center" }
  );

  y += 6;
  line(left, y, right, y, ink, 0.35);
  y += 4;

  /* Employee details */
  sectionTitle("Employee Details");

  const detailTop = y;
  const rowHeight = 8;
  const mid = center;

  const rows = [
    ["Employee Name", slipEmployee.name, "Employee Code", slipEmployee.code],
    ["Designation", slipEmployee.designation, "Department", slipEmployee.department],
    ["Date of Joining", formatDate(slipEmployee.joiningDate), "Payment Date", formatDate(slip.payment_date)],
    ["UAN", slipEmployee.uan, "ESIC Number", slipEmployee.esic]
  ];

  const detailHeight = rows.length * rowHeight;

  doc.setDrawColor(...border);
  doc.setLineWidth(0.25);
  doc.rect(left, detailTop, width, detailHeight);

  line(mid, detailTop, mid, detailTop + detailHeight, lightBorder, 0.25);

  rows.forEach((row, index) => {
    const rowY = detailTop + index * rowHeight;

    if (index > 0) {
      line(left, rowY, right, rowY, lightBorder, 0.2);
    }

    const leftLabel = row[0] + ":";
    const rightLabel = row[2] + ":";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.6);
    doc.setTextColor(...ink);

    write(leftLabel, left + 2, rowY + 5);
    write(rightLabel, mid + 2, rowY + 5);

    const leftLabelWidth = Math.min(
      doc.getTextWidth(leftLabel) + 2,
      27
    );

    const rightLabelWidth = Math.min(
      doc.getTextWidth(rightLabel) + 2,
      27
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);

    write(
      wrapped(row[1], width / 2 - leftLabelWidth - 5, 7.8)[0] || "—",
      left + leftLabelWidth + 3,
      rowY + 5
    );

    write(
      wrapped(row[3], width / 2 - rightLabelWidth - 5, 7.8)[0] || "—",
      mid + rightLabelWidth + 3,
      rowY + 5
    );
  });

  y += detailHeight + 7;

  /* Earnings and deductions */
  const gap = 4;
  const halfWidth = (width - gap) / 2;

  function drawTable(title, items, totalLabel, totalValue, x, tableWidth) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...ink);

    write(title, x, y);

    const tableTop = y + 3;
    const headerHeight = 7;
    const labelWidth = tableWidth - 23;

    doc.setFillColor(238, 238, 238);
    doc.rect(x, tableTop, tableWidth, headerHeight, "F");

    doc.setDrawColor(...border);
    doc.rect(x, tableTop, tableWidth, headerHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);

    write("DESCRIPTION", x + 2, tableTop + 4.6);
    write("AMOUNT", x + tableWidth - 2, tableTop + 4.6, {
      align: "right"
    });

    let rowY = tableTop + headerHeight;

    const actualItems = items.length
      ? items
      : [{ name: "—", amount: 0 }];

    for (const item of actualItems) {
      const description = firstValue(
        item.name,
        item.label,
        item.title
      );

      const descriptionLines = wrapped(description, labelWidth - 3, 7.2);
      const height = Math.max(7, descriptionLines.length * 3.5 + 3);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      doc.setTextColor(...ink);

      write(descriptionLines, x + 2, rowY + 4.5);

      write(
        amount(item.amount ?? item.value),
        x + tableWidth - 2,
        rowY + 4.5,
        { align: "right" }
      );

      line(
        x,
        rowY + height,
        x + tableWidth,
        rowY + height,
        lightBorder,
        0.2
      );

      rowY += height;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    doc.setTextColor(...ink);
    doc.setFillColor(246, 246, 246);

    doc.rect(x, rowY, tableWidth, 8, "F");
    doc.setDrawColor(...border);
    doc.rect(x, rowY, tableWidth, 8);

    write(totalLabel, x + 2, rowY + 5);

    write(
      amount(totalValue),
      x + tableWidth - 2,
      rowY + 5,
      { align: "right" }
    );

    return rowY + 8;
  }

  const earningsBottom = drawTable(
    "EARNINGS",
    earnings,
    "GROSS",
    slip.gross_salary,
    left,
    halfWidth
  );

  const deductionsBottom = drawTable(
    "DEDUCTIONS",
    deductions,
    "TOTAL",
    slip.total_deductions,
    left + halfWidth + gap,
    halfWidth
  );

  y = Math.max(earningsBottom, deductionsBottom) + 8;

  /* Net salary */
  doc.setDrawColor(...ink);
  doc.setLineWidth(0.6);
  doc.rect(left, y, width, 14);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ink);

  write("NET SALARY PAYABLE", left + 4, y + 8.5);

  doc.setFontSize(12);

  write(
    "INR " + amount(slip.net_salary),
    right - 4,
    y + 8.5,
    { align: "right" }
  );

  y += 19;

  /* Amount in words */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...ink);

  write("Amount in Words:", left, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  const wordsLines = wrapped(
    numberToIndianWords(slip.net_salary),
    width - 29,
    8
  );

  write(wordsLines, left + 29, y);
  y += Math.max(6, wordsLines.length * 4) + 3;

  /* Payment mode and remarks */
  if (slip.payment_mode || slip.remarks) {
    line(left, y, right, y, lightBorder, 0.25);
    y += 5;

    if (slip.payment_mode) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);

      write("Payment Mode:", left, y);

      doc.setFont("helvetica", "normal");
      write(String(slip.payment_mode), left + 25, y);

      y += 5;
    }

    if (slip.remarks) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);

      write("Remarks:", left, y);
      y += 4;

      doc.setFont("helvetica", "normal");

      const remarksLines = wrapped(slip.remarks, width, 8);

      write(remarksLines, left, y);
      y += remarksLines.length * 4 + 2;
    }
  }

  /* Signature */
  const signatureWidth = 55;
  const signatureX = right - signatureWidth;

  line(signatureX, y + 12, right, y + 12, ink, 0.35);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...ink);

  write(
    "Authorised Signatory",
    right - signatureWidth / 2,
    y + 17,
    { align: "center" }
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);

  write(
    "For " + (slipCompany.company_name || "Company"),
    right - signatureWidth / 2,
    y + 21,
    { align: "center" }
  );
}

/* -------------------- BUILD ONE COMBINED PDF -------------------- */

async function downloadSalarySlipsPDF(slips) {
  if (!window.jspdf?.jsPDF) {
    throw new Error(
      "PDF library has not loaded. Check the jsPDF script in login.html."
    );
  }

  if (!Array.isArray(slips) || slips.length === 0) {
    throw new Error("Please select at least one salary slip.");
  }

  if (!employee?.id) {
    throw new Error("Employee profile is not loaded. Please reload the page.");
  }

  /* Validate selected slips before generating the PDF. */
  for (const slip of slips) {
    if (String(slip.employee_id) !== String(employee.id)) {
      throw new Error(
        "A selected salary slip does not belong to your employee account."
      );
    }

    if (
      slip.company_id &&
      String(slip.company_id) !== String(employee.company_id)
    ) {
      throw new Error(
        "A selected salary slip belongs to a different company."
      );
    }
  }

  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const logoCache = new Map();

  for (let index = 0; index < slips.length; index++) {
    /* Every selected slip starts on its own page. */
    if (index > 0) {
      doc.addPage("a4", "portrait");
    }

    await renderSalarySlipPage(doc, slips[index], logoCache);
  }

  /* Footer and page numbering for the complete PDF. */
  const pageCount = doc.internal.getNumberOfPages();

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);

    doc.setDrawColor(190, 190, 190);
    doc.setLineWidth(0.25);

    doc.line(
      margin,
      pageHeight - 13,
      pageWidth - margin,
      pageHeight - 13
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(95, 95, 95);

    doc.text(
      "Computer-generated salary slip",
      margin,
      pageHeight - 8
    );

    doc.text(
      `${page} / ${pageCount}`,
      pageWidth - margin,
      pageHeight - 8,
      { align: "right" }
    );
  }

  const safeName = String(employee.full_name || "Employee")
    .replace(/[^a-z0-9_-]/gi, "_");

  const months = slips
    .map(slip => String(slip.salary_month || "unknown").slice(0, 7))
    .sort();

  const firstMonth = months[0] || "unknown";
  const lastMonth = months[months.length - 1] || firstMonth;

  const filename = slips.length === 1
    ? `SalarySlip_${safeName}_${firstMonth}.pdf`
    : `SalarySlips_${safeName}_${firstMonth}_to_${lastMonth}.pdf`;

  /* One save call = one downloaded PDF file. */
  doc.save(filename);
}

/* -------------------- SELECTION BUTTON STATE -------------------- */

function updateSelectionButtons() {
  const button = $("downloadSelectedBtn");

  if (button) {
    button.disabled = selectedSlipIds.size === 0;
    button.textContent = selectedSlipIds.size
      ? `Download Selected (${selectedSlipIds.size})`
      : "Download Selected";
  }
}

/* -------------------- DOWNLOAD ONE SLIP -------------------- */

function attachSalarySlipEvents() {
  const table = $("slipsTable");

  if (table && table.dataset.pdfEventsAttached !== "true") {
    table.dataset.pdfEventsAttached = "true";

    table.addEventListener("change", event => {
      const checkbox = event.target.closest(".slip-select");

      if (!checkbox) return;

      const id = String(checkbox.dataset.slipId);

      if (checkbox.checked) {
        selectedSlipIds.add(id);
      } else {
        selectedSlipIds.delete(id);
      }

      updateSelectionButtons();
    });

    table.addEventListener("click", async event => {
      const button = event.target.closest(".single-download");

      if (!button) return;

      const slip = salarySlips.find(
        item => String(item.id) === String(button.dataset.slipId)
      );

      if (!slip) {
        showMessage("Salary slip not found. Refresh the page.", "error");
        return;
      }

      button.disabled = true;
      showMessage("Preparing salary slip PDF...", "info");

      try {
        await downloadSalarySlipsPDF([slip]);
        showMessage("Salary slip PDF downloaded successfully.", "success");
      } catch (error) {
        console.error("Single PDF download error:", error);

        showMessage(
          error.message || "PDF download failed.",
          "error"
        );
      } finally {
        button.disabled = false;
      }
    });
  }

  const downloadButton = $("downloadSelectedBtn");

  if (
    downloadButton &&
    downloadButton.dataset.pdfEventsAttached !== "true"
  ) {
    downloadButton.dataset.pdfEventsAttached = "true";

    downloadButton.addEventListener("click", async () => {
      const chosenSlips = salarySlips
        .filter(slip => selectedSlipIds.has(String(slip.id)))
        .sort((a, b) =>
          String(a.salary_month || "").localeCompare(
            String(b.salary_month || "")
          )
        );

      if (!chosenSlips.length) {
        showMessage("Please select at least one salary month.", "warning");
        return;
      }

      downloadButton.disabled = true;
      downloadButton.textContent = "Preparing combined PDF...";

      try {
        showMessage(
          `Preparing one PDF containing ${chosenSlips.length} salary slip(s)...`,
          "info"
        );

        await downloadSalarySlipsPDF(chosenSlips);

        showMessage(
          `One PDF containing ${chosenSlips.length} salary slip(s) downloaded successfully.`,
          "success"
        );
      } catch (error) {
        console.error("Combined PDF download error:", error);

        showMessage(
          error.message || "PDF download failed.",
          "error"
        );
      } finally {
        updateSelectionButtons();
      }
    });
  }

  updateSelectionButtons();
}

/* -------------------- LOGOUT -------------------- */

async function logoutEmployee() {
  showMessage("Signing out...", "info");

  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    console.error("Logout error:", error);
    showMessage("Could not sign out: " + error.message, "error");
    return;
  }

  window.location.replace("login.html");
}

function attachLogoutEvents() {
  const logoutButton = $("logoutBtn") ||
    $("logoutButton") ||
    $("signOutBtn");

  if (
    logoutButton &&
    logoutButton.dataset.logoutAttached !== "true"
  ) {
    logoutButton.dataset.logoutAttached = "true";
    logoutButton.addEventListener("click", logoutEmployee);
  }
}

/* -------------------- INITIALIZE DASHBOARD -------------------- */

async function initEmployeeDashboard() {
  if (dashboardInitialized || dashboardLoading) return;

  dashboardLoading = true;
  showMessage("Loading your dashboard...", "info");

  try {
    if (
      typeof supabaseClient === "undefined" ||
      !supabaseClient?.auth
    ) {
      throw new Error(
        "Supabase client is not initialized. Check login.html script order."
      );
    }

    const profileLoaded = await loadMyProfile();

    if (!profileLoaded) return;

    await loadMySalarySlips();

    attachSalarySlipEvents();
    attachLogoutEvents();

    dashboardInitialized = true;
    showMessage("", "");
  } catch (error) {
    console.error("Employee dashboard initialization failed:", error);

    showMessage(
      error.message || "Dashboard could not load.",
      "error"
    );
  } finally {
    dashboardLoading = false;
  }
}

/* -------------------- AUTH STATE -------------------- */

if (
  typeof supabaseClient !== "undefined" &&
  supabaseClient?.auth
) {
  supabaseClient.auth.onAuthStateChange(event => {
    if (event === "SIGNED_OUT") {
      window.location.replace("login.html");
    }
  });
}

/* -------------------- START -------------------- */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initEmployeeDashboard,
    { once: true }
  );
} else {
  initEmployeeDashboard();
}