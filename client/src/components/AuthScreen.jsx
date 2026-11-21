import React, { useState } from 'react';
import PrivacyPolicyModal from './PrivacyPolicyModal';
import TermsConditionsModal from './TermsConditionsModal';

export default function AuthScreen({ needsSetup, offline, onDone }) {
  const inviteToken = new URLSearchParams(window.location.search).get('invite');
  const [tab, setTab] = useState(inviteToken ? 'invite' : needsSetup ? 'setup' : 'login'); // 'login' | 'register' | 'forgot' | 'setup' | 'invite'
  const [invitePw, setInvitePw] = useState({ password: '', confirm: '' });

  // Login state
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  // Register state
  const [regForm, setRegForm] = useState({
    fullName: '',
    email: '',
    phoneNumber: '',
    username: '',
    password: '',
    otp: '',
    acceptTerms: false
  });
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);

  // Forgot Password state
  const [forgotForm, setForgotForm] = useState({ identifier: '', phoneNumber: '', otp: '', newPassword: '' });
  const [forgotOtpSent, setForgotOtpSent] = useState(false);

  // Setup state (first-run admin)
  const [setupForm, setSetupForm] = useState({ username: 'admin', name: 'Administrator', password: '', setupKey: '' });

  // Modal overlays
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Cooldown timer handler
  const startCooldown = (sec = 60) => {
    setOtpCooldown(sec);
    const interval = setInterval(() => {
      setOtpCooldown(prev => {
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
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
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

  // 2. Handle Register - Step 1: Send OTP
  const handleSendRegOtp = async () => {
    if (!regForm.phoneNumber.trim()) {
      setError('Please enter your mobile phone number');
      return;
    }
    if (!regForm.username.trim()) {
      setError('Please choose a unique username');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/auth/register/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: regForm.phoneNumber, username: regForm.username })
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Failed to send verification code');

      setOtpSent(true);
      setNotice(json.message || `Verification OTP sent to ${regForm.phoneNumber}`);
      startCooldown(60);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // 2. Handle Register - Step 2: Verify & Complete
  const handleCompleteRegister = async (e) => {
    e.preventDefault();
    if (!regForm.acceptTerms) {
      setError('You must accept the Terms of Service and Privacy Policy to register');
      return;
    }
    if (!regForm.otp.trim()) {
      setError('Please enter the 6-digit verification code sent to your phone');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regForm)
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

  // 3. Handle Forgot Password - Step 1: Send OTP
  const handleSendForgotOtp = async () => {
    if (!forgotForm.identifier.trim()) {
      setError('Please enter your username or registered phone number');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: forgotForm.identifier })
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Could not send reset code');

      setForgotOtpSent(true);
      setForgotForm(f => ({ ...f, phoneNumber: json.data?.phoneNumber || f.identifier }));
      setNotice(`Reset code sent to ${json.data?.phoneNumber || 'your registered number'}`);
      startCooldown(60);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // 3. Handle Forgot Password - Step 2: Reset
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forgotForm)
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Password reset failed');

      setNotice('Password updated successfully! Please sign in with your new password.');
      setTab('login');
      setLoginForm(l => ({ ...l, password: '' }));
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

  // Accept a team invitation: the member sets their own password, then lands in the owner's workspace
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
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Could not accept invitation');
      window.history.replaceState(null, '', window.location.pathname); // drop the token from the URL
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap d-flex align-items-center justify-content-center min-vh-100 p-3" style={{ backgroundColor: '#0f172a' }}>
      <div className="card border-0 shadow-lg rounded-4 overflow-hidden" style={{ width: '100%', maxWidth: '440px', backgroundColor: '#ffffff' }}>
        {/* Header */}
        <div className="p-4 text-center border-bottom bg-body-tertiary">
          <div className="msquare-logo-badge mx-auto mb-2" style={{ width: 52, height: 52, fontSize: '1.4rem' }}>M²</div>
          <h4 className="fw-bold mb-1 text-dark">WaCRM</h4>
          <p className="text-muted small mb-0">Multi-Account WhatsApp Helpdesk & CRM</p>
        </div>

        {/* Tab Selector (unless in first-run setup mode) */}
        {tab !== 'setup' && tab !== 'invite' && (
          <div className="d-flex border-bottom bg-light">
            <button
              className={`btn flex-grow-1 rounded-0 py-2 fw-semibold small ${tab === 'login' ? 'btn-white border-bottom border-primary border-2 text-primary' : 'text-secondary'}`}
              onClick={() => { setTab('login'); setError(''); setNotice(''); }}
            >
              Sign In
            </button>
            <button
              className={`btn flex-grow-1 rounded-0 py-2 fw-semibold small ${tab === 'register' ? 'btn-white border-bottom border-primary border-2 text-primary' : 'text-secondary'}`}
              onClick={() => { setTab('register'); setError(''); setNotice(''); }}
            >
              Register
            </button>
          </div>
        )}

        {/* Card Body */}
        <div className="p-4">
          {offline && <div className="alert alert-warning py-2 small mb-3">Cannot reach the backend server. Check your connection.</div>}
          {error && <div className="alert alert-danger py-2 small mb-3">{error}</div>}
          {notice && <div className="alert alert-success py-2 small mb-3">{notice}</div>}

          {tab === 'invite' && (
            <form onSubmit={handleAcceptInvite}>
              <h6 className="fw-bold mb-1">Join your team workspace</h6>
              <p className="text-muted small">Set a password to activate your member account. Your username was chosen by the account owner.</p>
              <input type="password" className="form-control mb-2" placeholder="New password (8+ chars, letters and numbers)" autoComplete="new-password" required
                value={invitePw.password} onChange={e => setInvitePw({ ...invitePw, password: e.target.value })} />
              <input type="password" className="form-control mb-3" placeholder="Confirm password" autoComplete="new-password" required
                value={invitePw.confirm} onChange={e => setInvitePw({ ...invitePw, confirm: e.target.value })} />
              <button className="btn btn-msquare-primary w-100" disabled={busy}>{busy ? 'Joining…' : 'Accept invitation'}</button>
              <button type="button" className="btn btn-link btn-sm w-100 mt-2" onClick={() => setTab('login')}>I already have an account</button>
            </form>
          )}

          {/* TAB 1: SIGN IN */}
          {tab === 'login' && (
            <form onSubmit={handleLogin}>
              <div className="mb-3">
                <label className="form-label small fw-semibold text-secondary">Username or Mobile Number</label>
                <div className="input-group">
                  <span className="input-group-text bg-light border-end-0 text-muted"><i className="bi bi-person"></i></span>
                  <input
                    className="form-control border-start-0"
                    placeholder="e.g. johndoe or +919876543210"
                    value={loginForm.username}
                    onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div className="mb-3">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <label className="form-label small fw-semibold text-secondary mb-0">Password</label>
                  <button
                    type="button"
                    className="btn btn-link p-0 small text-decoration-none text-muted"
                    style={{ fontSize: '0.8rem' }}
                    onClick={() => { setTab('forgot'); setError(''); setNotice(''); }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="input-group">
                  <span className="input-group-text bg-light border-end-0 text-muted"><i className="bi bi-lock"></i></span>
                  <input
                    type="password"
                    className="form-control border-start-0"
                    placeholder="Enter your password"
                    value={loginForm.password}
                    onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                    required
                  />
                </div>
              </div>

              <button className="btn btn-msquare-primary w-100 py-2 fw-semibold mt-2" disabled={busy}>
                {busy ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                Sign In
              </button>

              <div className="text-center mt-3">
                <span className="small text-muted">Don't have an account yet? </span>
                <button
                  type="button"
                  className="btn btn-link p-0 small text-decoration-none fw-semibold"
                  onClick={() => { setTab('register'); setError(''); setNotice(''); }}
                >
                  Create one now
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: REGISTER */}
          {tab === 'register' && (
            <form onSubmit={handleCompleteRegister}>
              <div className="mb-2">
                <label className="form-label small fw-semibold text-secondary mb-1">Full Name</label>
                <input
                  className="form-control form-control-sm"
                  placeholder="e.g. John Doe"
                  value={regForm.fullName}
                  onChange={e => setRegForm({ ...regForm, fullName: e.target.value })}
                  required
                />
              </div>

              <div className="mb-2">
                <label className="form-label small fw-semibold text-secondary mb-1">Unique Username</label>
                <input
                  className="form-control form-control-sm"
                  placeholder="4–30 chars (letters, numbers, _ .)"
                  value={regForm.username}
                  onChange={e => setRegForm({ ...regForm, username: e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '') })}
                  required
                />
              </div>

              <div className="mb-2">
                <label className="form-label small fw-semibold text-secondary mb-1">Email (optional)</label>
                <input type="email" className="form-control form-control-sm" placeholder="you@company.com"
                  value={regForm.email} onChange={e => setRegForm({ ...regForm, email: e.target.value })} />
              </div>

              <div className="mb-2">
                <label className="form-label small fw-semibold text-secondary mb-1">Mobile Number (with country code)</label>
                <div className="input-group input-group-sm">
                  <input
                    className="form-control"
                    placeholder="+91 9876543210"
                    value={regForm.phoneNumber}
                    onChange={e => setRegForm({ ...regForm, phoneNumber: e.target.value })}
                    disabled={otpSent}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    disabled={busy || otpCooldown > 0}
                    onClick={handleSendRegOtp}
                  >
                    {otpCooldown > 0 ? `${otpCooldown}s` : otpSent ? 'Resend' : 'Send OTP'}
                  </button>
                </div>
              </div>

              {otpSent && (
                <div className="mb-2 p-2 border rounded-3 bg-light">
                  <label className="form-label small fw-semibold text-primary mb-1">
                    <i className="bi bi-shield-lock me-1"></i>Enter 6-Digit OTP Code
                  </label>
                  <input
                    className="form-control form-control-sm text-center fw-bold letter-spacing-2"
                    placeholder="••••••"
                    maxLength={6}
                    value={regForm.otp}
                    onChange={e => setRegForm({ ...regForm, otp: e.target.value })}
                    required
                  />
                  <span className="text-muted" style={{ fontSize: '0.72rem' }}>A verification code has been dispatched to your phone number.</span>
                </div>
              )}

              <div className="mb-3">
                <label className="form-label small fw-semibold text-secondary mb-1">Password (min 8 chars)</label>
                <input
                  type="password"
                  className="form-control form-control-sm"
                  placeholder="Create a strong password"
                  value={regForm.password}
                  onChange={e => setRegForm({ ...regForm, password: e.target.value })}
                  required
                />
              </div>

              <div className="form-check mb-3">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="termsCheck"
                  checked={regForm.acceptTerms}
                  onChange={e => setRegForm({ ...regForm, acceptTerms: e.target.checked })}
                  required
                />
                <label className="form-check-label small text-muted" htmlFor="termsCheck" style={{ fontSize: '0.78rem' }}>
                  I accept the{' '}
                  <button type="button" className="btn btn-link p-0 text-decoration-none small" onClick={() => setShowTerms(true)}>
                    Terms of Service
                  </button>{' '}
                  and{' '}
                  <button type="button" className="btn btn-link p-0 text-decoration-none small" onClick={() => setShowPrivacy(true)}>
                    Privacy Policy
                  </button>.
                </label>
              </div>

              <button className="btn btn-msquare-primary w-100 py-2 fw-semibold" disabled={busy || !otpSent}>
                {busy ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                Verify & Register
              </button>

              <div className="text-center mt-3">
                <span className="small text-muted">Already registered? </span>
                <button
                  type="button"
                  className="btn btn-link p-0 small text-decoration-none fw-semibold"
                  onClick={() => { setTab('login'); setError(''); setNotice(''); }}
                >
                  Sign in
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: FORGOT PASSWORD */}
          {tab === 'forgot' && (
            <form onSubmit={handleResetPassword}>
              <h6 className="fw-bold mb-2">Reset Password</h6>
              <p className="text-muted small mb-3">Enter your username or phone to receive a verification code.</p>

              <div className="mb-2">
                <label className="form-label small fw-semibold text-secondary mb-1">Username or Phone</label>
                <div className="input-group input-group-sm">
                  <input
                    className="form-control"
                    placeholder="johndoe or +919876543210"
                    value={forgotForm.identifier}
                    onChange={e => setForgotForm({ ...forgotForm, identifier: e.target.value })}
                    disabled={forgotOtpSent}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    disabled={busy || otpCooldown > 0}
                    onClick={handleSendForgotOtp}
                  >
                    {otpCooldown > 0 ? `${otpCooldown}s` : forgotOtpSent ? 'Resend' : 'Send Code'}
                  </button>
                </div>
              </div>

              {forgotOtpSent && (
                <>
                  <div className="mb-2">
                    <label className="form-label small fw-semibold text-secondary mb-1">6-Digit OTP</label>
                    <input
                      className="form-control form-control-sm text-center fw-bold"
                      placeholder="••••••"
                      maxLength={6}
                      value={forgotForm.otp}
                      onChange={e => setForgotForm({ ...forgotForm, otp: e.target.value })}
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-secondary mb-1">New Password (min 8 chars)</label>
                    <input
                      type="password"
                      className="form-control form-control-sm"
                      placeholder="Enter new password"
                      value={forgotForm.newPassword}
                      onChange={e => setForgotForm({ ...forgotForm, newPassword: e.target.value })}
                      required
                    />
                  </div>
                  <button className="btn btn-msquare-primary w-100 py-2 fw-semibold" disabled={busy}>
                    {busy ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                    Update Password
                  </button>
                </>
              )}

              <div className="text-center mt-3">
                <button
                  type="button"
                  className="btn btn-link p-0 small text-decoration-none"
                  onClick={() => { setTab('login'); setError(''); setNotice(''); }}
                >
                  <i className="bi bi-arrow-left me-1"></i>Back to Sign In
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: FIRST RUN SETUP */}
          {tab === 'setup' && (
            <form onSubmit={handleSetup}>
              <h6 className="fw-bold mb-2">Initial Administrator Setup</h6>
              <p className="text-muted small mb-3">Create the primary superadmin account to claim this installation.</p>

              <div className="mb-2">
                <label className="form-label small fw-semibold">Admin Username</label>
                <input
                  className="form-control form-control-sm"
                  value={setupForm.username}
                  onChange={e => setSetupForm({ ...setupForm, username: e.target.value })}
                  required
                />
              </div>

              <div className="mb-2">
                <label className="form-label small fw-semibold">Admin Name</label>
                <input
                  className="form-control form-control-sm"
                  value={setupForm.name}
                  onChange={e => setSetupForm({ ...setupForm, name: e.target.value })}
                />
              </div>

              <div className="mb-3">
                <label className="form-label small fw-semibold">Admin Password (min 8 chars)</label>
                <input
                  type="password"
                  className="form-control form-control-sm"
                  placeholder="Set strong administrator password"
                  value={setupForm.password}
                  onChange={e => setSetupForm({ ...setupForm, password: e.target.value })}
                  required
                />
              </div>

              <button className="btn btn-msquare-primary w-100 py-2 fw-semibold" disabled={busy}>
                {busy ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                Initialize Platform
              </button>
            </form>
          )}
        </div>

        {/* Footer info & Links */}
        <div className="px-4 py-2 border-top bg-light d-flex justify-content-between align-items-center" style={{ fontSize: '0.75rem' }}>
          <span className="text-muted">© 2026 WaCRM Platform</span>
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

      {/* Modals */}
      {showPrivacy && <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />}
      {showTerms && <TermsConditionsModal onClose={() => setShowTerms(false)} />}
    </div>
  );
}
