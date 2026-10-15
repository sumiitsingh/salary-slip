
const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const message = document.getElementById("message");

function showMessage(text, type = "error") {
  message.textContent = text;
  message.className = `message ${type}`;
}

async function redirectByRole(user) {
  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error("Could not verify your account role. Please try again.");
  }

  if (profile?.role === "admin") {
    window.location.replace("admin.html");
    return;
  }

  const { data: employee, error: employeeError } = await supabaseClient
    .from("employees")
    .select("id")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (employeeError) {
    throw new Error("Could not verify your employee account.");
  }

  if (employee?.id) {
    window.location.replace("employee-dashboard.html");
    return;
  }

  await supabaseClient.auth.signOut();
  throw new Error(
    "Your account is not activated or linked. Please use Employee Activation."
  );
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in...";
  showMessage("");

  try {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    await redirectByRole(data.user);
  } catch (error) {
    showMessage(error.message || "Login failed.");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign In";
  }
});
