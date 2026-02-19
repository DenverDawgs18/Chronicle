    const form = document.getElementById('authForm');
    const errorMessage = document.getElementById('errorMessage');
    const submitBtn = document.getElementById('submitBtn');
    const formTitle = document.getElementById('formTitle');
    const formSubtitle = document.getElementById('formSubtitle');
    const loginModeBtn = document.getElementById('loginModeBtn');
    const registerModeBtn = document.getElementById('registerModeBtn');
    const passwordHint = document.getElementById('passwordHint');
    const passwordInput = document.getElementById('password');
    const codeAction = document.getElementById('codeAction');
    const subscribeAction = document.getElementById('subscribeAction');

    let isLoginMode = true;

    // Check for next parameter (e.g., coming from /code page)
    const urlParams = new URLSearchParams(window.location.search);
    const nextPage = urlParams.get('next') || '';
    const isCodeRedeem = nextPage.includes('/code');

    // If coming from code redemption, show contextual messaging
    if (isCodeRedeem) {
      formTitle.textContent = 'Sign In to Redeem Code';
      formSubtitle.textContent = 'Sign in or create an account to use your access code';
      if (codeAction) codeAction.style.display = 'none';
    }

    loginModeBtn.addEventListener('click', () => {
      isLoginMode = true;
      loginModeBtn.classList.add('active');
      registerModeBtn.classList.remove('active');
      if (isCodeRedeem) {
        formTitle.textContent = 'Sign In to Redeem Code';
        formSubtitle.textContent = 'Sign in to use your access code';
      } else {
        formTitle.textContent = 'Welcome Back';
        formSubtitle.textContent = 'Sign in to continue tracking';
      }
      submitBtn.textContent = 'Sign In';
      passwordInput.setAttribute('autocomplete', 'current-password');
      passwordHint.classList.remove('show');
      errorMessage.classList.remove('show');
      if (!isCodeRedeem && codeAction) codeAction.style.display = '';
      if (subscribeAction) subscribeAction.style.display = 'none';
    });

    registerModeBtn.addEventListener('click', () => {
      isLoginMode = false;
      registerModeBtn.classList.add('active');
      loginModeBtn.classList.remove('active');
      if (isCodeRedeem) {
        formTitle.textContent = 'Create Account to Redeem Code';
        formSubtitle.textContent = 'Create an account to use your access code';
      } else {
        formTitle.textContent = 'Create Account';
        formSubtitle.textContent = 'Start your VBT journey';
      }
      submitBtn.textContent = 'Create Account';
      passwordInput.setAttribute('autocomplete', 'new-password');
      passwordHint.classList.add('show');
      errorMessage.classList.remove('show');
      if (!isCodeRedeem && codeAction) codeAction.style.display = '';
      if (subscribeAction) subscribeAction.style.display = '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      errorMessage.classList.remove('show');
      submitBtn.disabled = true;
      submitBtn.textContent = isLoginMode ? 'Signing in...' : 'Creating account...';

      const endpoint = isLoginMode ? '/login' : '/register';
      const body = { email, password };
      if (nextPage) {
        body.next = nextPage;
      }

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        });

        const data = await response.json();

        if (response.ok) {
          window.location.href = data.redirect || '/tracker';
        } else {
          errorMessage.textContent = data.error || 'An error occurred';
          errorMessage.classList.add('show');
          submitBtn.disabled = false;
          submitBtn.textContent = isLoginMode ? 'Sign In' : 'Create Account';
        }
      } catch (error) {
        errorMessage.textContent = 'An error occurred. Please try again.';
        errorMessage.classList.add('show');
        submitBtn.disabled = false;
        submitBtn.textContent = isLoginMode ? 'Sign In' : 'Create Account';
      }
    });
