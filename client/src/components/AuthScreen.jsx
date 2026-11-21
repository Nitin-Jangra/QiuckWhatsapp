import React, { useState } from 'react';
import PrivacyPolicyModal from './PrivacyPolicyModal';
import TermsConditionsModal from './TermsConditionsModal';

export default function AuthScreen({ needsSetup, offline, onDone }) {
  const inviteToken = new URLSearchParams(window.location.search).get('invite');
  const [tab, setTab] = useState(inviteToken ? 'invite' : needsSetup ? 'setup' : 'login'); // 'login' | 'register' | 'forgot' | 'setup' | 'invite'
  const [showPassword, setShowPassword] = useState(false);

  // Login state
  const [loginForm, setLoginForm] = useState({ identifier: '', password: '' });

  // Register state (Email OTP)
  const [regForm, setRegForm] = useState({
    fullName: '',
    username: '',
    email: '',
    otp: '',
    password: '',
    acceptTerms: false
  });
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);

  // Forgot Password state
  const [forgotForm, setForgotForm] = useState({ identifier: '', otp: '', newPassword: '' });
  const [forgotOtpSent, setForgotOtpSent] = useState(false);
  const [forgotCooldown, setForgotCooldown] = useState(0);

  // Setup state (first-run admin)
  const [setupForm, setSetupForm] = useState({ username: 'admin', name: 'Administrator', password: '', setupKey: '' });

  // Invite state
  const [invitePw, setInvitePw] = useState({ password: '', confirm: '' });

  // Modals
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  // Feedback states
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // OTP cooldown helper
  const startCooldown = (setter, sec = 60) => {
    setter(sec);
    const interval = setInterval(() => {
      setter(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // 1. Handle Login
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginForm.identifier.trim()) {
      setError('Please enter your email, username, or phone number');
      return;
    }
    if (!loginForm.password) {
      setError('Please enter your password');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: loginForm.identifier.trim(), password: loginForm.password })
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || `Server error (HTTP ${res.status})`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // 2. Handle Register - Step 1: Send Email OTP
  const handleSendRegOtp = async () => {
    if (!regForm.email.trim()) {
      setError('Please enter your email address to receive verification OTP');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regForm.email.trim())) {
      setError('Please enter a valid email address (e.g. name@company.com)');
      return;
    }
    if (!regForm.username.trim()) {
      setError('Please choose a username');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/auth/register/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: regForm.email.trim(), username: regForm.username.trim() })
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Failed to send verification code');

      setOtpSent(true);
      const code = json.data?.devOtp;
      if (code) {
        setRegForm(f => ({ ...f, otp: code }));
        setNotice(`Verification code is: ${code} (auto-filled below). To receive emails in your inbox, set up SMTP in .env.`);
      } else {
        setNotice(json.message || `Verification code sent to ${regForm.email}. Please check your Inbox and Spam folder.`);
      }
      startCooldown(setOtpCooldown, 60);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // 2. Handle Register - Step 2: Verify Email OTP & Complete
  const handleCompleteRegister = async (e) => {
    e.preventDefault();
    if (!regForm.acceptTerms) {
      setError('You must accept the Terms of Service and Privacy Policy to register');
      return;
    }
    if (!otpSent) {
      setError('Please click "Send Code" to verify your email address first');
      return;
    }
    if (!regForm.otp.trim() || regForm.otp.trim().length < 6) {
      setError('Please enter the 6-digit verification code sent to your email');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: regForm.fullName.trim(),
          username: regForm.username.trim(),
          email: regForm.email.trim().toLowerCase(),
          otp: regForm.otp.trim(),
          password: regForm.password,
          acceptTerms: regForm.acceptTerms
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Failed to complete registration');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // 3. Handle Forgot Password - Step 1: Send OTP to email
  const handleSendForgotOtp = async () => {
    if (!forgotForm.identifier.trim()) {
      setError('Please enter your email or username');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/auth/forgot-password/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: forgotForm.identifier.trim() })
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Could not send reset code');

      setForgotOtpSent(true);
      const code = json.data?.devOtp;
      if (code) {
        setForgotForm(f => ({ ...f, otp: code }));
        setNotice(`Reset code is: ${code} (auto-filled below).`);
      } else {
        setNotice(json.message || 'If this account exists, a reset code has been sent.');
      }
      startCooldown(setForgotCooldown, 60);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // 3. Handle Forgot Password - Step 2: Reset Password
  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!forgotForm.otp.trim()) {
      setError('Please enter the 6-digit reset code');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: forgotForm.identifier.trim(),
          otp: forgotForm.otp.trim(),
          newPassword: forgotForm.newPassword
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Password reset failed');

      setNotice('Password updated successfully! Please sign in with your new credentials.');
      setTab('login');
      setLoginForm({ identifier: forgotForm.identifier, password: '' });
      setForgotOtpSent(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // 4. Handle Legacy Setup
  const handleSetup = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setupForm)
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Setup failed');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // 5. Handle Accept Invitation
  const handleAcceptInvite = async (e) => {
    e.preventDefault();
    setError('');
    if (invitePw.password !== invitePw.confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      const res = await fetch('/api/team/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken, password: invitePw.password })
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Could not accept invitation');
      window.history.replaceState(null, '', window.location.pathname);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wa-auth-screen min-vh-100 d-flex flex-column" style={{ backgroundColor: '#eae6df', position: 'relative', overflowX: 'hidden' }}>
      {/* WhatsApp Green Top Header Strip */}
      <div
        className="wa-header-strip w-100"
        style={{
          backgroundColor: '#00a884',
          height: '222px',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1
        }}
      >
        <div className="container-xl h-100 d-flex align-items-center px-4" style={{ maxWidth: '1040px' }}>
          <div className="d-flex align-items-center gap-3">
            <div
              className="rounded-circle d-flex align-items-center justify-content-center shadow-sm"
              style={{ width: 44, height: 44, backgroundColor: '#ffffff', color: '#00a884', fontSize: '1.6rem' }}
            >
              <i className="bi bi-whatsapp"></i>
            </div>
            <div>
              <span className="text-white fw-bold tracking-wide" style={{ letterSpacing: '0.08em', fontSize: '0.95rem' }}>
                WACRM WEB
              </span>
              <span className="badge ms-2 text-white" style={{ backgroundColor: 'rgba(255,255,255,0.22)', fontSize: '0.7rem', fontWeight: 600 }}>
                BUSINESS
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Elevated Card Container */}
      <div className="container-xl flex-grow-1 d-flex flex-column align-items-center justify-content-center px-3" style={{ zIndex: 2, paddingTop: '100px', paddingBottom: '30px', maxWidth: '1040px' }}>
        <div
          className="wa-card card border-0 shadow-lg rounded-4 w-100 overflow-hidden"
          style={{
            backgroundColor: '#ffffff',
            boxShadow: '0 17px 50px 0 rgba(11,20,26,.19)',
            minHeight: '560px'
          }}
        >
          <div className="row g-0 flex-grow-1">
            {/* Left Column: Interactive Auth Panel */}
            <div className="col-12 col-lg-7 p-4 p-md-5 d-flex flex-column justify-content-between">
              <div>
                {/* Brand & Title */}
                <div className="d-flex align-items-center justify-content-between mb-4">
                  <div>
                    <h3 className="fw-bold mb-1 text-dark" style={{ letterSpacing: '-0.02em' }}>
                      {tab === 'login' && 'Sign in to WaCRM Web'}
                      {tab === 'register' && 'Create your account'}
                      {tab === 'forgot' && 'Reset your password'}
                      {tab === 'setup' && 'Initial Administrator Setup'}
                      {tab === 'invite' && 'Join your team workspace'}
                    </h3>
                    <p className="text-muted small mb-0">
                      {tab === 'login' && 'Manage your multi-agent WhatsApp desk with ease.'}
                      {tab === 'register' && 'Enter your details and verify your email via 6-digit OTP.'}
                      {tab === 'forgot' && 'We will send a 6-digit verification code to your email.'}
                      {tab === 'setup' && 'Create the primary admin account for this installation.'}
                      {tab === 'invite' && 'Set a password to activate your team membership.'}
                    </p>
                  </div>
                  <div
                    className="rounded-3 d-flex align-items-center justify-content-center"
                    style={{ width: 44, height: 44, backgroundColor: 'rgba(0,168,132,0.1)', color: '#00a884', fontSize: '1.3rem' }}
                  >
                    <i className={tab === 'register' ? 'bi bi-person-plus-fill' : tab === 'forgot' ? 'bi bi-key-fill' : 'bi bi-shield-lock-fill'}></i>
                  </div>
                </div>

                {/* Tabs: Sign In / Create Account (hidden during setup/invite/forgot) */}
                {tab !== 'setup' && tab !== 'invite' && (
                  <div className="d-flex p-1 rounded-3 mb-4" style={{ backgroundColor: '#f0f2f5' }}>
                    <button
                      type="button"
                      className={`btn flex-grow-1 py-2 rounded-2 fw-semibold small border-0 transition-all ${
                        tab === 'login' ? 'bg-white shadow-sm text-dark' : 'text-muted'
                      }`}
                      style={{ transition: 'all 0.2s ease' }}
                      onClick={() => { setTab('login'); setError(''); setNotice(''); }}
                    >
                      <i className="bi bi-box-arrow-in-right me-1 text-success"></i> Sign In
                    </button>
                    <button
                      type="button"
                      className={`btn flex-grow-1 py-2 rounded-2 fw-semibold small border-0 transition-all ${
                        tab === 'register' ? 'bg-white shadow-sm text-dark' : 'text-muted'
                      }`}
                      style={{ transition: 'all 0.2s ease' }}
                      onClick={() => { setTab('register'); setError(''); setNotice(''); }}
                    >
                      <i className="bi bi-person-plus me-1 text-success"></i> Create Account
                    </button>
                  </div>
                )}

                {/* Feedback Alerts */}
                {offline && (
                  <div className="alert alert-warning py-2 px-3 small rounded-3 mb-3 d-flex align-items-center gap-2">
                    <i className="bi bi-wifi-off fs-6"></i>
                    <span>Cannot reach backend server. Please verify your network.</span>
                  </div>
                )}
                {error && (
                  <div className="alert alert-danger py-2 px-3 small rounded-3 mb-3 d-flex align-items-center gap-2">
                    <i className="bi bi-exclamation-triangle-fill fs-6 text-danger"></i>
                    <span className="flex-grow-1">{error}</span>
                  </div>
                )}
                {notice && (
                  <div className="alert alert-success py-2 px-3 small rounded-3 mb-3 d-flex align-items-center gap-2" style={{ backgroundColor: '#d1fae5', borderColor: '#a7f3d0', color: '#065f46' }}>
                    <i className="bi bi-check-circle-fill fs-6 text-success"></i>
                    <span className="flex-grow-1">{notice}</span>
                  </div>
                )}

                {/* TAB 1: SIGN IN */}
                {tab === 'login' && (
                  <form onSubmit={handleLogin} noValidate>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold text-secondary mb-1">Email, Username, or Phone</label>
                      <div className="input-group">
                        <span className="input-group-text bg-white border-end-0 text-muted">
                          <i className="bi bi-person"></i>
                        </span>
                        <input
                          type="text"
                          className="form-control border-start-0 ps-0"
                          placeholder="e.g. alex@company.com or alex99"
                          value={loginForm.identifier}
                          onChange={e => setLoginForm({ ...loginForm, identifier: e.target.value })}
                          autoFocus
                          required
                          style={{ fontSize: '0.92rem' }}
                        />
                      </div>
                    </div>

                    <div className="mb-3">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <label className="form-label small fw-semibold text-secondary mb-0">Password</label>
                        <button
                          type="button"
                          className="btn btn-link p-0 small text-decoration-none"
                          style={{ color: '#00a884', fontSize: '0.82rem', fontWeight: 600 }}
                          onClick={() => { setTab('forgot'); setError(''); setNotice(''); }}
                        >
                          Forgot password?
                        </button>
                      </div>
                      <div className="input-group">
                        <span className="input-group-text bg-white border-end-0 text-muted">
                          <i className="bi bi-lock"></i>
                        </span>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          className="form-control border-start-0 border-end-0 ps-0"
                          placeholder="Enter your password"
                          value={loginForm.password}
                          onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                          required
                          style={{ fontSize: '0.92rem' }}
                        />
                        <button
                          type="button"
                          className="input-group-text bg-white border-start-0 text-muted"
                          onClick={() => setShowPassword(!showPassword)}
                          title={showPassword ? 'Hide password' : 'Show password'}
                        >
                          <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`}></i>
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="btn w-100 py-2 mt-3 fw-semibold text-white shadow-sm d-flex align-items-center justify-content-center gap-2"
                      style={{
                        backgroundColor: '#00a884',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '0.95rem'
                      }}
                      disabled={busy}
                    >
                      {busy ? (
                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                      ) : (
                        <>
                          <span>Sign In to WaCRM</span>
                          <i className="bi bi-arrow-right"></i>
                        </>
                      )}
                    </button>

                    <div className="text-center mt-4 pt-2 border-top">
                      <span className="small text-muted">Don't have an account yet? </span>
                      <button
                        type="button"
                        className="btn btn-link p-0 small text-decoration-none fw-bold"
                        style={{ color: '#00a884' }}
                        onClick={() => { setTab('register'); setError(''); setNotice(''); }}
                      >
                        Create an account
                      </button>
                    </div>
                  </form>
                )}

                {/* TAB 2: REGISTER (EMAIL OTP) */}
                {tab === 'register' && (
                  <form onSubmit={handleCompleteRegister} noValidate>
                    <div className="row g-2 mb-2">
                      <div className="col-12 col-sm-6">
                        <label className="form-label small fw-semibold text-secondary mb-1">Full Name</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="e.g. Alex Johnson"
                          value={regForm.fullName}
                          onChange={e => setRegForm({ ...regForm, fullName: e.target.value })}
                          required
                          style={{ fontSize: '0.9rem' }}
                        />
                      </div>
                      <div className="col-12 col-sm-6">
                        <label className="form-label small fw-semibold text-secondary mb-1">Username</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="alex99 (letters, numbers, _ .)"
                          value={regForm.username}
                          onChange={e => setRegForm({ ...regForm, username: e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '') })}
                          required
                          style={{ fontSize: '0.9rem' }}
                        />
                      </div>
                    </div>

                    {/* Email Input with Send Code button */}
                    <div className="mb-2">
                      <label className="form-label small fw-semibold text-secondary mb-1">
                        Email Address <span className="text-muted fw-normal">(for OTP verification)</span>
                      </label>
                      <div className="input-group">
                        <span className="input-group-text bg-white border-end-0 text-muted">
                          <i className="bi bi-envelope"></i>
                        </span>
                        <input
                          type="email"
                          className="form-control border-start-0 ps-0"
                          placeholder="you@company.com"
                          value={regForm.email}
                          onChange={e => setRegForm({ ...regForm, email: e.target.value })}
                          disabled={otpSent && otpCooldown > 0}
                          required
                          style={{ fontSize: '0.9rem' }}
                        />
                        <button
                          type="button"
                          className="btn px-3 fw-semibold small"
                          style={{
                            backgroundColor: otpCooldown > 0 ? '#f0f2f5' : '#00a884',
                            color: otpCooldown > 0 ? '#64748b' : '#ffffff',
                            border: '1px solid #00a884',
                            borderTopRightRadius: '10px',
                            borderBottomRightRadius: '10px'
                          }}
                          disabled={busy || otpCooldown > 0}
                          onClick={handleSendRegOtp}
                        >
                          {otpCooldown > 0 ? `Resend (${otpCooldown}s)` : otpSent ? 'Resend Code' : 'Send Code'}
                        </button>
                      </div>
                    </div>

                    {/* 6-Digit Email OTP Input */}
                    {otpSent && (
                      <div className="mb-3 p-3 rounded-3 border" style={{ backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }}>
                        <div className="d-flex align-items-center justify-content-between mb-1">
                          <label className="form-label small fw-bold text-success mb-0 d-flex align-items-center gap-1">
                            <i className="bi bi-shield-check"></i> Enter 6-Digit Email Code
                          </label>
                          <span className="badge bg-success-subtle text-success border border-success-subtle" style={{ fontSize: '0.7rem' }}>
                            Valid for 10 mins
                          </span>
                        </div>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          className="form-control text-center fw-bold fs-5 tracking-widest mt-1"
                          placeholder="••••••"
                          value={regForm.otp}
                          onChange={e => setRegForm({ ...regForm, otp: e.target.value.replace(/[^0-9]/g, '') })}
                          autoFocus
                          required
                          style={{ letterSpacing: '0.35em', backgroundColor: '#ffffff' }}
                        />
                        <div className="d-flex justify-content-between align-items-center mt-1">
                          <small className="text-muted" style={{ fontSize: '0.72rem' }}>
                            {regForm.otp ? `Code (${regForm.otp}) auto-filled.` : 'Check your inbox and spam/junk folder.'}
                          </small>
                          {otpCooldown === 0 && (
                            <button
                              type="button"
                              className="btn btn-link p-0 small text-decoration-none fw-semibold"
                              style={{ color: '#00a884', fontSize: '0.75rem' }}
                              onClick={handleSendRegOtp}
                            >
                              Didn't get code? Resend
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Password */}
                    <div className="mb-3">
                      <label className="form-label small fw-semibold text-secondary mb-1">
                        Password <span className="text-muted fw-normal">(8+ characters, letters & numbers)</span>
                      </label>
                      <div className="input-group">
                        <span className="input-group-text bg-white border-end-0 text-muted">
                          <i className="bi bi-lock"></i>
                        </span>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          className="form-control border-start-0 border-end-0 ps-0"
                          placeholder="Create a strong password"
                          value={regForm.password}
                          onChange={e => setRegForm({ ...regForm, password: e.target.value })}
                          required
                          style={{ fontSize: '0.9rem' }}
                        />
                        <button
                          type="button"
                          className="input-group-text bg-white border-start-0 text-muted"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`}></i>
                        </button>
                      </div>
                    </div>

                    {/* Terms Checkbox */}
                    <div className="form-check mb-3">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        id="termsCheck"
                        checked={regForm.acceptTerms}
                        onChange={e => setRegForm({ ...regForm, acceptTerms: e.target.checked })}
                        required
                        style={{ cursor: 'pointer' }}
                      />
                      <label className="form-check-label small text-muted" htmlFor="termsCheck" style={{ fontSize: '0.8rem', cursor: 'pointer' }}>
                        I agree to the{' '}
                        <button type="button" className="btn btn-link p-0 small text-decoration-none fw-semibold" style={{ color: '#00a884' }} onClick={() => setShowTerms(true)}>
                          Terms of Service
                        </button>{' '}
                        and{' '}
                        <button type="button" className="btn btn-link p-0 small text-decoration-none fw-semibold" style={{ color: '#00a884' }} onClick={() => setShowPrivacy(true)}>
                          Privacy Policy
                        </button>.
                      </label>
                    </div>

                    <button
                      type="submit"
                      className="btn w-100 py-2 fw-semibold text-white shadow-sm d-flex align-items-center justify-content-center gap-2"
                      style={{
                        backgroundColor: '#00a884',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '0.95rem'
                      }}
                      disabled={busy || !otpSent}
                    >
                      {busy ? (
                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                      ) : (
                        <>
                          <span>Verify & Create Account</span>
                          <i className="bi bi-check2-circle"></i>
                        </>
                      )}
                    </button>

                    <div className="text-center mt-3 pt-2 border-top">
                      <span className="small text-muted">Already have an account? </span>
                      <button
                        type="button"
                        className="btn btn-link p-0 small text-decoration-none fw-bold"
                        style={{ color: '#00a884' }}
                        onClick={() => { setTab('login'); setError(''); setNotice(''); }}
                      >
                        Sign in
                      </button>
                    </div>
                  </form>
                )}

                {/* TAB 3: FORGOT PASSWORD */}
                {tab === 'forgot' && (
                  <form onSubmit={handleResetPassword} noValidate>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold text-secondary mb-1">
                        Registered Email or Username
                      </label>
                      <div className="input-group">
                        <span className="input-group-text bg-white border-end-0 text-muted">
                          <i className="bi bi-envelope"></i>
                        </span>
                        <input
                          type="text"
                          className="form-control border-start-0 ps-0"
                          placeholder="you@company.com or username"
                          value={forgotForm.identifier}
                          onChange={e => setForgotForm({ ...forgotForm, identifier: e.target.value })}
                          disabled={forgotOtpSent}
                          required
                          style={{ fontSize: '0.9rem' }}
                        />
                        <button
                          type="button"
                          className="btn px-3 fw-semibold small"
                          style={{
                            backgroundColor: forgotCooldown > 0 ? '#f0f2f5' : '#00a884',
                            color: forgotCooldown > 0 ? '#64748b' : '#ffffff',
                            border: '1px solid #00a884'
                          }}
                          disabled={busy || forgotCooldown > 0}
                          onClick={handleSendForgotOtp}
                        >
                          {forgotCooldown > 0 ? `${forgotCooldown}s` : forgotOtpSent ? 'Resend' : 'Send Code'}
                        </button>
                      </div>
                    </div>

                    {forgotOtpSent && (
                      <>
                        <div className="mb-3">
                          <label className="form-label small fw-semibold text-secondary mb-1">6-Digit Verification Code</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            className="form-control text-center fw-bold fs-5 tracking-widest"
                            placeholder="••••••"
                            value={forgotForm.otp}
                            onChange={e => setForgotForm({ ...forgotForm, otp: e.target.value.replace(/[^0-9]/g, '') })}
                            required
                            style={{ letterSpacing: '0.35em' }}
                          />
                        </div>
                        <div className="mb-3">
                          <label className="form-label small fw-semibold text-secondary mb-1">New Password (8+ chars)</label>
                          <div className="input-group">
                            <span className="input-group-text bg-white border-end-0 text-muted">
                              <i className="bi bi-lock"></i>
                            </span>
                            <input
                              type={showPassword ? 'text' : 'password'}
                              className="form-control border-start-0 border-end-0 ps-0"
                              placeholder="Enter your new password"
                              value={forgotForm.newPassword}
                              onChange={e => setForgotForm({ ...forgotForm, newPassword: e.target.value })}
                              required
                              style={{ fontSize: '0.9rem' }}
                            />
                            <button
                              type="button"
                              className="input-group-text bg-white border-start-0 text-muted"
                              onClick={() => setShowPassword(!showPassword)}
                            >
                              <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`}></i>
                            </button>
                          </div>
                        </div>
                        <button
                          type="submit"
                          className="btn w-100 py-2 fw-semibold text-white shadow-sm mt-2"
                          style={{ backgroundColor: '#00a884', border: 'none', borderRadius: '10px' }}
                          disabled={busy}
                        >
                          {busy ? <span className="spinner-border spinner-border-sm" /> : 'Set New Password & Sign In'}
                        </button>
                      </>
                    )}

                    <div className="text-center mt-3 pt-2">
                      <button
                        type="button"
                        className="btn btn-link p-0 small text-decoration-none fw-semibold"
                        style={{ color: '#00a884' }}
                        onClick={() => { setTab('login'); setError(''); setNotice(''); }}
                      >
                        <i className="bi bi-arrow-left me-1"></i> Back to Sign In
                      </button>
                    </div>
                  </form>
                )}

                {/* TAB 4: FIRST RUN ADMIN SETUP */}
                {tab === 'setup' && (
                  <form onSubmit={handleSetup} noValidate>
                    <div className="alert alert-info py-2 small mb-3">
                      Welcome! Create the initial Super Administrator account to claim and configure this server.
                    </div>
                    <div className="mb-2">
                      <label className="form-label small fw-semibold">Admin Username</label>
                      <input
                        className="form-control"
                        value={setupForm.username}
                        onChange={e => setSetupForm({ ...setupForm, username: e.target.value })}
                        required
                      />
                    </div>
                    <div className="mb-2">
                      <label className="form-label small fw-semibold">Full Name</label>
                      <input
                        className="form-control"
                        value={setupForm.name}
                        onChange={e => setSetupForm({ ...setupForm, name: e.target.value })}
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold">Admin Password (min 8 chars)</label>
                      <input
                        type="password"
                        className="form-control"
                        placeholder="Create strong admin password"
                        value={setupForm.password}
                        onChange={e => setSetupForm({ ...setupForm, password: e.target.value })}
                        required
                      />
                    </div>
                    <button
                      className="btn w-100 py-2 fw-semibold text-white"
                      style={{ backgroundColor: '#00a884', border: 'none', borderRadius: '10px' }}
                      disabled={busy}
                    >
                      {busy ? <span className="spinner-border spinner-border-sm" /> : 'Initialize Administrator Account'}
                    </button>
                  </form>
                )}

                {/* TAB 5: INVITATION ACCEPTANCE */}
                {tab === 'invite' && (
                  <form onSubmit={handleAcceptInvite} noValidate>
                    <div className="mb-2">
                      <label className="form-label small fw-semibold">New Password (8+ chars, letters and numbers)</label>
                      <input
                        type="password"
                        className="form-control mb-2"
                        placeholder="Choose a secure password"
                        value={invitePw.password}
                        onChange={e => setInvitePw({ ...invitePw, password: e.target.value })}
                        required
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold">Confirm Password</label>
                      <input
                        type="password"
                        className="form-control"
                        placeholder="Confirm password"
                        value={invitePw.confirm}
                        onChange={e => setInvitePw({ ...invitePw, confirm: e.target.value })}
                        required
                      />
                    </div>
                    <button
                      className="btn w-100 py-2 fw-semibold text-white"
                      style={{ backgroundColor: '#00a884', border: 'none', borderRadius: '10px' }}
                      disabled={busy}
                    >
                      {busy ? 'Activating…' : 'Accept Invitation & Enter Workspace'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-link btn-sm w-100 mt-2 text-decoration-none"
                      style={{ color: '#00a884' }}
                      onClick={() => setTab('login')}
                    >
                      I already have an account
                    </button>
                  </form>
                )}
              </div>

              {/* Card Bottom Links */}
              <div className="pt-3 mt-4 border-top d-flex justify-content-between align-items-center" style={{ fontSize: '0.78rem' }}>
                <span className="text-muted d-flex align-items-center gap-1">
                  <i className="bi bi-shield-lock-fill text-success"></i> End-to-end encrypted
                </span>
                <div className="d-flex gap-2">
                  <button type="button" className="btn btn-link p-0 text-decoration-none text-muted small" onClick={() => setShowTerms(true)}>
                    Terms
                  </button>
                  <span className="text-muted">•</span>
                  <button type="button" className="btn btn-link p-0 text-decoration-none text-muted small" onClick={() => setShowPrivacy(true)}>
                    Privacy
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: WhatsApp Web Showcase Panel */}
            <div
              className="col-12 col-lg-5 p-4 p-md-5 d-none d-lg-flex flex-column justify-content-between border-start"
              style={{
                backgroundColor: '#f8fafc',
                backgroundImage: 'radial-gradient(rgba(0, 168, 132, 0.08) 1.5px, transparent 1.5px)',
                backgroundSize: '20px 20px'
              }}
            >
              <div>
                <div className="d-flex align-items-center gap-2 mb-3">
                  <span className="badge rounded-pill px-3 py-2 text-white" style={{ backgroundColor: '#00a884', fontSize: '0.75rem' }}>
                    <i className="bi bi-stars me-1"></i> Official Experience
                  </span>
                </div>
                <h4 className="fw-bold text-dark mb-2" style={{ letterSpacing: '-0.02em' }}>
                  Use WaCRM on your computer
                </h4>
                <p className="text-muted small mb-4" style={{ lineHeight: '1.6' }}>
                  Pair your business WhatsApp lines directly with your team. Reply faster, collaborate in real time, and scale customer support.
                </p>

                {/* Feature List Cards */}
                <div className="d-flex flex-column gap-3">
                  <div className="d-flex align-items-start gap-3 p-3 bg-white rounded-3 shadow-sm border border-light">
                    <div
                      className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                      style={{ width: 38, height: 38, backgroundColor: 'rgba(0,168,132,0.12)', color: '#00a884' }}
                    >
                      <i className="bi bi-envelope-check-fill fs-5"></i>
                    </div>
                    <div>
                      <div className="fw-bold text-dark small">Email OTP Verification</div>
                      <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                        Zero SMS fees. Instant 6-digit cryptographic authentication sent directly to your email.
                      </div>
                    </div>
                  </div>

                  <div className="d-flex align-items-start gap-3 p-3 bg-white rounded-3 shadow-sm border border-light">
                    <div
                      className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                      style={{ width: 38, height: 38, backgroundColor: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}
                    >
                      <i className="bi bi-qr-code-scan fs-5"></i>
                    </div>
                    <div>
                      <div className="fw-bold text-dark small">Instant QR Multi-Device Pairing</div>
                      <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                        Connect one or multiple official WhatsApp numbers with seamless QR code scanning.
                      </div>
                    </div>
                  </div>

                  <div className="d-flex align-items-start gap-3 p-3 bg-white rounded-3 shadow-sm border border-light">
                    <div
                      className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                      style={{ width: 38, height: 38, backgroundColor: 'rgba(249,115,22,0.12)', color: '#f97316' }}
                    >
                      <i className="bi bi-people-fill fs-5"></i>
                    </div>
                    <div>
                      <div className="fw-bold text-dark small">Multi-Agent Team Collaboration</div>
                      <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                        Assign chats to team members, share notes, and eliminate duplicate customer replies.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Quick Guide */}
              <div className="pt-3 border-top mt-4">
                <div className="d-flex align-items-center justify-content-between text-muted" style={{ fontSize: '0.75rem' }}>
                  <span>Need help getting started?</span>
                  <a
                    href="https://msquareprofessionals.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-decoration-none fw-semibold"
                    style={{ color: '#00a884' }}
                  >
                    Documentation <i className="bi bi-box-arrow-up-right ms-1"></i>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Global Footer info */}
        <div className="text-center mt-3 text-muted" style={{ fontSize: '0.75rem' }}>
          <span>© 2026 WaCRM Platform • Multi-Account WhatsApp Desk • Built with privacy & security</span>
        </div>
      </div>

      {/* Modals */}
      {showPrivacy && <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />}
      {showTerms && <TermsConditionsModal onClose={() => setShowTerms(false)} />}
    </div>
  );
}
