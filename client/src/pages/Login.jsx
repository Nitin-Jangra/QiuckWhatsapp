import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light py-5 px-3">
      <div className="card shadow-sm border-0" style={{ maxWidth: '440px', width: '100%', borderRadius: '12px' }}>
        <div className="card-body p-4 p-sm-5">
          {/* Logo / Header */}
          <div className="text-center mb-4">
            <div
              className="d-inline-flex align-items-center justify-content-center bg-success text-white rounded-circle mb-3"
              style={{ width: '56px', height: '56px' }}
            >
              <i className="bi bi-whatsapp fs-3"></i>
            </div>
            <h4 className="fw-bold mb-1">WaCRM Platform</h4>
            <p className="text-muted small">Multi-Tenant WhatsApp CRM & Branch Manager</p>
          </div>

          {error && (
            <div className="alert alert-danger py-2 px-3 small d-flex align-items-center mb-3">
              <i className="bi bi-exclamation-triangle-fill me-2"></i>
              <div>{error}</div>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label small fw-semibold text-secondary">Email Address</label>
              <div className="input-group">
                <span className="input-group-text bg-white text-muted">
                  <i className="bi bi-envelope"></i>
                </span>
                <input
                  type="email"
                  className="form-control"
                  placeholder="name@business.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="form-label small fw-semibold text-secondary">Password</label>
              <div className="input-group">
                <span className="input-group-text bg-white text-muted">
                  <i className="bi bi-lock"></i>
                </span>
                <input
                  type="password"
                  className="form-control"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-success w-100 py-2 fw-semibold"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                  Signing In...
                </>
              ) : (
                'Sign In to CRM'
              )}
            </button>
          </form>

          {/* Quick Persona Selector for Testing */}
          <div className="mt-4 pt-3 border-top">
            <div className="small fw-bold text-muted text-uppercase mb-2" style={{ fontSize: '0.75rem', letterSpacing: '0.5px' }}>
              Instant Evaluation Personas
            </div>
            <div className="d-flex flex-column gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline-primary text-start d-flex justify-content-between align-items-center"
                onClick={() => handleQuickLogin('admin@demo.com')}
                disabled={isSubmitting}
              >
                <span>
                  <i className="bi bi-building me-2"></i>
                  <strong>Tenant Admin</strong> (Healthcare Demo)
                </span>
                <span className="badge bg-primary-subtle text-primary">Demo</span>
              </button>

              <button
                type="button"
                className="btn btn-sm btn-outline-secondary text-start d-flex justify-content-between align-items-center"
                onClick={() => handleQuickLogin('agent1@demo.com')}
                disabled={isSubmitting}
              >
                <span>
                  <i className="bi bi-headset me-2"></i>
                  <strong>Support Agent</strong> (Sarah Connor)
                </span>
                <span className="badge bg-secondary-subtle text-secondary">Agent</span>
              </button>

              <button
                type="button"
                className="btn btn-sm btn-outline-dark text-start d-flex justify-content-between align-items-center"
                onClick={() => handleQuickLogin('root@wacrm.com')}
                disabled={isSubmitting}
              >
                <span>
                  <i className="bi bi-shield-lock me-2"></i>
                  <strong>Root Admin</strong> (Global System)
                </span>
                <span className="badge bg-dark-subtle text-dark">Super</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
