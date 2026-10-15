const activationForm = document.getElementById("activationForm");
const activateBtn = document.getElementById("activateBtn");
const message = document.getElementById("message");

function showMessage(text, type = "error") {
  message.textContent = text;
  message.className = `message ${type}`;
}

activationForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email").value.trim().toLowerCase();
  const code = document.getElementById("code").value.trim();
  const password = document.getElementById("password").value;
  const confirmPassword =
    document.getElementById("confirmPassword").value;

  if (password.length < 8) {
    showMessage("Password must be at least 8 characters.");
    return;
  }

  if (password !== confirmPassword) {
    showMessage("Passwords do not match.");
    return;
  }

  activateBtn.disabled = true;
  activateBtn.textContent = "Activating...";
  showMessage("");

  let accountCreated = false;

  try {
    // Try creating a new account first.
    let { data, error } = await supabaseClient.auth.signUp({
      email,
      password
    });

    if (error && /already registered|already been registered|user already exists/i.test(error.message)) {
      // Existing account: sign in using the newly entered password.
      const loginResult = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (loginResult.error) {
        throw new Error(
          "This email already has an account. Enter its existing password " +
          "to continue, or reset that password from Supabase Auth."
        );
      }

      data = loginResult.data;
    } else if (error) {
      throw error;
    } else {
      accountCreated = true;
    }

    if (!data?.user || !data?.session) {
      throw new Error(
        "No active session found. Confirm email verification is disabled " +
        "in Supabase Authentication settings."
      );
    }

    // Set the chosen password for a newly created account.
    // Existing accounts must sign in with their current password first.
    const { data: activationData, error: activationError } =
      await supabaseClient.rpc("activate_employee", {
        p_code: code,
        p_email: email,
        p_password: password
      });

    if (activationError) {
      throw activationError;
    }

    if (!activationData?.success) {
      throw new Error(
        activationData?.message || "Employee activation failed."
      );
    }

    showMessage(
      "Employee account activated successfully. Redirecting to login...",
      "success"
    );

    await supabaseClient.auth.signOut();

    setTimeout(() => {
      window.location.replace("login.html");
    }, 1200);

  } catch (error) {
    showMessage(error.message || "Activation failed. Please try again.");
  } finally {
    activateBtn.disabled = false;
    activateBtn.textContent = "Activate Account";
  }
});