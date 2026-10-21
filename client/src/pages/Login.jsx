import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('aarav@msquare.com');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickLogin = (presetEmail) => {
    setEmail(presetEmail);
    setError('');
    setIsSubmitting(true);
    login(presetEmail)
      .catch((err) => setError(err.message || 'Failed to sign in'))
      .finally(() => setIsSubmitting(false));
  };

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center py-5 px-3" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div
        className="card shadow-sm border-0"
        style={{
          maxWidth: '460px',
          width: '100%',
          borderRadius: '16px',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--card-shadow)'
        }}
      >
        <div className="card-body p-4 p-sm-5">
          {/* M Square Header */}
          <div className="text-center mb-4">
            <div className="d-flex justify-content-center align-items-center gap-3 mb-3">
              <div className="msquare-logo-badge" style={{ width: '46px', height: '46px', fontSize: '1.4rem' }}>
                <span>M²</span>
              </div>
              <div className="msquare-brand-stacked text-start">
                <span className="brand-word-top" style={{ fontSize: '1.35rem' }}>M SQUARE</span>
                <span className="brand-word-bottom" style={{ fontSize: '0.78rem' }}>PROFESSIONALS</span>
              </div>
            </div>
            <span className="msquare-helpdesk-badge d-inline-flex align-items-center gap-1">
              <i className="bi bi-whatsapp fs-6 text-success"></i>
              <span>WhatsApp Helpdesk CRM</span>
            </span>
            <p className="text-muted small mt-2 mb-0">
              Branch-Scoped WhatsApp CRM & Employee Workflows
            </p>
          </div>

          {error && (
            <div className="alert alert-danger py-2 px-3 small d-flex align-items-center mb-3">
              <i className="bi bi-exclamation-triangle-fill me-2"></i>
              <div>{error}</div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label small fw-semibold text-secondary">Work Email</label>
              <div className="input-group">
                <span className="input-group-text border-0" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                  <i className="bi bi-envelope"></i>
                </span>
                <input
                  type="email"
                  className="form-control message-input"
                  placeholder="aarav@msquare.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label small fw-semibold text-secondary">Password</label>
              <div className="input-group">
                <span className="input-group-text border-0" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                  <i className="bi bi-lock"></i>
                </span>
                <input
                  type="password"
                  className="form-control message-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-msquare-primary w-100 py-2.5 fw-semibold mb-3"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                  Signing In...
                </>
              ) : (
                <>
                  <i className="bi bi-box-arrow-in-right me-1"></i>
                  Sign In to Helpdesk
                </>
              )}
            </button>
          </form>

          {/* Branch Lead Quick Login Focus */}
          <div className="mt-3 pt-3 border-top" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="small fw-bold text-uppercase" style={{ fontSize: '0.74rem', color: 'var(--brand-orange)' }}>
                <i className="bi bi-shield-check me-1"></i> Branch Lead Account
              </span>
              <span className="badge bg-warning-subtle text-warning small">WhatsApp QR Access</span>
            </div>

            <button
              type="button"
              className="btn btn-sm btn-outline-warning w-100 text-start d-flex justify-content-between align-items-center py-2 mb-3"
              onClick={() => handleQuickLogin('aarav@msquare.com')}
              disabled={isSubmitting}
            >
              <div>
                <div className="fw-bold small text-body">Aarav Sharma (Branch Lead)</div>
                <div className="text-muted" style={{ fontSize: '0.72rem' }}>Greater Noida Hub • Can Pair WhatsApp & QR</div>
              </div>
              <i className="bi bi-arrow-right-circle fs-5 text-warning"></i>
            </button>

            <div className="small fw-bold text-uppercase text-muted mb-2" style={{ fontSize: '0.72rem' }}>
              Branch Support Agents (Isolated Chat Queues):
            </div>
            <div className="d-flex flex-column gap-1.5">
              <button
                type="button"
                className="btn btn-sm btn-msquare-outline text-start d-flex justify-content-between align-items-center py-1.5"
                onClick={() => handleQuickLogin('diya@msquare.com')}
                disabled={isSubmitting}
              >
                <div>
                  <div className="fw-semibold small">Diya Patel (Agent 1)</div>
                  <div className="text-muted" style={{ fontSize: '0.7rem' }}>Helpdesk Specialist • Isolated Inbound Queue</div>
                </div>
                <span className="badge bg-secondary-subtle text-muted">Agent</span>
              </button>

              <button
                type="button"
                className="btn btn-sm btn-msquare-outline text-start d-flex justify-content-between align-items-center py-1.5"
                onClick={() => handleQuickLogin('rohan@msquare.com')}
                disabled={isSubmitting}
              >
                <div>
                  <div className="fw-semibold small">Rohan Mehta (Agent 2)</div>
                  <div className="text-muted" style={{ fontSize: '0.7rem' }}>Support Specialist • Isolated Inbound Queue</div>
                </div>
                <span className="badge bg-secondary-subtle text-muted">Agent</span>
              </button>

              <button
                type="button"
                className="btn btn-sm btn-msquare-outline text-start d-flex justify-content-between align-items-center py-1.5"
                onClick={() => handleQuickLogin('kavita@msquare.com')}
                disabled={isSubmitting}
              >
                <div>
                  <div className="fw-semibold small">Kavita Sen (Agent 3)</div>
                  <div className="text-muted" style={{ fontSize: '0.7rem' }}>Customer Success • Isolated Inbound Queue</div>
                </div>
                <span className="badge bg-secondary-subtle text-muted">Agent</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
