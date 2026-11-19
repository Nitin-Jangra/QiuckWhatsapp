import React from 'react';

export default function PrivacyPolicyModal({ onClose }) {
  return (
    <div className="modal d-block" style={{ background: 'rgba(15, 23, 42, 0.75)', zIndex: 1060 }} onClick={onClose}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable" onClick={e => e.stopPropagation()}>
        <div className="modal-content shadow-lg border-0 rounded-4">
          <div className="modal-header border-bottom px-4 py-3 bg-body-tertiary">
            <div className="d-flex align-items-center gap-2">
              <i className="bi bi-shield-check text-success fs-5"></i>
              <h5 className="modal-title fw-bold mb-0">Privacy Policy</h5>
            </div>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
          </div>
          <div className="modal-body px-4 py-3 small text-secondary" style={{ lineHeight: '1.6' }}>
            <p className="text-muted small"><strong>Effective Date:</strong> November 19, 2026</p>

            <h6 className="fw-bold text-dark mt-3">1. Overview and Commitment</h6>
            <p>
              WaCRM ("the Platform", "we", "us", or "our") respects your privacy and is dedicated to protecting your personal data.
              This Privacy Policy explains how your information, WhatsApp credentials, communications data, and metadata are handled when you access or use the WaCRM web platform.
            </p>

            <h6 className="fw-bold text-dark mt-3">2. Information We Collect</h6>
            <ul>
              <li><strong>Account Credentials:</strong> Full name, verified mobile phone number, unique username, and encrypted password hash (Argon2id / scrypt). We never store plaintext passwords.</li>
              <li><strong>Authentication Data:</strong> One-Time Password (OTP) verification tokens, session identifiers, and IP access timestamps.</li>
              <li><strong>WhatsApp Session Identifiers:</strong> Ephemeral cryptographic keys and session state necessary to maintain authenticated WhatsApp Web socket connections via QR pairing.</li>
              <li><strong>Message & Media Cache:</strong> Transmitted text messages, contact phone numbers, and temporary media files (images, audio notes, video, documents) requested through connected WhatsApp sessions.</li>
            </ul>

            <h6 className="fw-bold text-dark mt-3">3. How Information is Used</h6>
            <ul>
              <li>To authenticate your identity and provide isolated multi-tenant workspace access.</li>
              <li>To pair and maintain active sessions with your designated WhatsApp accounts.</li>
              <li>To synchronize incoming and outgoing WhatsApp messages, chats, and media across your connected devices.</li>
              <li>To enforce platform security, detect unauthorized access, and prevent spam or abusive activity.</li>
            </ul>

            <h6 className="fw-bold text-dark mt-3">4. Multi-Tenant Data Isolation & Security</h6>
            <p>
              Your data is strictly isolated. No other registered user on the platform can view, access, or intercept your WhatsApp accounts, conversation threads, contacts, or media files. All database queries enforce strict tenant ownership constraints, and session keys are protected with server-side encryption.
            </p>

            <h6 className="fw-bold text-dark mt-3">5. Third-Party Services & WhatsApp Compliance</h6>
            <p>
              WaCRM connects to the WhatsApp network via the WhatsApp Web protocol. By connecting your phone numbers, you agree to comply with WhatsApp's Terms of Service and Acceptable Use Policies. We do not sell, rent, or monetize your message contents or personal data with any advertising networks.
            </p>

            <h6 className="fw-bold text-dark mt-3">6. Data Retention and Account Deletion</h6>
            <p>
              You maintain full ownership of your data. When you unlink or delete a WhatsApp account from your dashboard, all corresponding session credentials and cached messages are permanently purged from server memory and disk. You may request complete account deletion at any time through the platform settings.
            </p>

            <h6 className="fw-bold text-dark mt-3">7. Contact Information</h6>
            <p className="mb-0">
              For privacy-related inquiries, data access requests, or security concerns, contact our designated privacy team through your platform administrator.
            </p>
          </div>
          <div className="modal-footer border-top px-4 py-2 bg-body-tertiary">
            <button type="button" className="btn btn-sm btn-secondary px-3" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
