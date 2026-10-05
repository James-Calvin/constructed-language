(function bootstrapAccessGate(globalScope) {
  "use strict";

  const ACCESS_STORAGE_KEY = "secret.access.sha256.v1";
  const EXPECTED_PASSWORD_HASH =
    "a97d146c3ec79433a57884aa32e9ded3c3c5a62dd29fef3d05387d90c571126f";

  document.documentElement.classList.add("auth-locked");

  function getStorage() {
    try {
      return globalScope.localStorage;
    } catch (error) {
      return null;
    }
  }

  async function sha256(value) {
    if (!globalScope.crypto || !globalScope.crypto.subtle) {
      throw new Error("This browser does not support the secure hash API.");
    }

    const bytes = new TextEncoder().encode(value);
    const digest = await globalScope.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function loadProtectedScripts() {
    const protectedScripts = Array.from(document.querySelectorAll("script[data-protected-src]"));

    return protectedScripts.reduce(
      (chain, placeholder) =>
        chain.then(
          () =>
            new Promise((resolve, reject) => {
              const script = document.createElement("script");
              script.src = placeholder.dataset.protectedSrc;
              script.onload = resolve;
              script.onerror = () => reject(new Error(`Could not load ${script.src}.`));
              document.body.appendChild(script);
            })
        ),
      Promise.resolve()
    );
  }

  let hasUnlocked = false;

  async function unlock(gate) {
    if (hasUnlocked) {
      return;
    }

    hasUnlocked = true;
    document.documentElement.classList.remove("auth-locked");
    document.documentElement.classList.add("auth-unlocked");
    gate.remove();

    try {
      await loadProtectedScripts();
    } catch (error) {
      console.error("Failed to start the protected application.", error);
    }
  }

  function createGate() {
    const gate = document.createElement("main");
    gate.className = "access-gate";
    gate.setAttribute("aria-labelledby", "accessGateTitle");
    gate.innerHTML = `
      <form class="access-card" novalidate>
        <h1 id="accessGateTitle">Private access</h1>
        <p>Enter the password to continue.</p>
        <label for="accessPassword">Password</label>
        <input id="accessPassword" name="password" type="password" autocomplete="current-password" required autofocus>
        <button type="submit">Unlock</button>
        <p class="access-error is-hidden" role="alert"></p>
      </form>
    `;
    document.body.prepend(gate);
    return gate;
  }

  async function initialize() {
    const gate = createGate();
    const form = gate.querySelector("form");
    const passwordInput = gate.querySelector("input[type='password']");
    const submitButton = gate.querySelector("button[type='submit']");
    const errorMessage = gate.querySelector(".access-error");
    const storage = getStorage();

    if (storage && storage.getItem(ACCESS_STORAGE_KEY) === EXPECTED_PASSWORD_HASH) {
      await unlock(gate);
      return;
    }

    passwordInput.focus();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      errorMessage.classList.add("is-hidden");

      try {
        const suppliedHash = await sha256(passwordInput.value);
        if (suppliedHash !== EXPECTED_PASSWORD_HASH) {
          passwordInput.value = "";
          errorMessage.textContent = "That password is not correct.";
          errorMessage.classList.remove("is-hidden");
          passwordInput.focus();
          return;
        }

        if (storage) {
          storage.setItem(ACCESS_STORAGE_KEY, suppliedHash);
        }
        await unlock(gate);
      } catch (error) {
        errorMessage.textContent = error.message || "The password could not be checked.";
        errorMessage.classList.remove("is-hidden");
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})(window);
