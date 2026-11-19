import React from 'react';

export default function TermsConditionsModal({ onClose }) {
  return (
    <div className="modal d-block" style={{ background: 'rgba(15, 23, 42, 0.75)', zIndex: 1060 }} onClick={onClose}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable" onClick={e => e.stopPropagation()}>
        <div className="modal-content shadow-lg border-0 rounded-4">
          <div className="modal-header border-bottom px-4 py-3 bg-body-tertiary">
            <div className="d-flex align-items-center gap-2">
              <i className="bi bi-file-earmark-text text-primary fs-5"></i>
              <h5 className="modal-title fw-bold mb-0">Terms & Conditions of Service</h5>
            </div>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
          </div>
          <div className="modal-body px-4 py-3 small text-secondary" style={{ lineHeight: '1.6' }}>
            <p className="text-muted small"><strong>Last Revised:</strong> November 19, 2026</p>

            <h6 className="fw-bold text-dark mt-3">1. Agreement to Terms</h6>
            <p>
              By creating an account, pairing WhatsApp accounts, or accessing the WaCRM platform, you acknowledge and agree to be bound by these Terms and Conditions. If you do not agree to these terms, you must not access or use this service.
            </p>

            <h6 className="fw-bold text-dark mt-3">2. User Account and Security</h6>
            <ul>
              <li>You must provide accurate, current, and complete registration details, including your real name and verified mobile phone number.</li>
              <li>You are solely responsible for safeguarding your login credentials and for all activities that occur under your account.</li>
              <li>You agree to immediately notify the platform administrators of any unauthorized use of your account or security breach.</li>
            </ul>

            <h6 className="fw-bold text-dark mt-3">3. Acceptable Use Policy</h6>
            <p>
              You agree not to use the platform to:
            </p>
            <ul>
              <li>Send unsolicited bulk messages, spam, phishing, scams, or malicious automated content.</li>
              <li>Harass, threaten, defraud, or violate the legal rights of any customer, contact, or individual.</li>
              <li>Distribute software viruses, malware, or illegal and prohibited media content.</li>
              <li>Circumvent or attempt to tamper with multi-tenant workspace isolation or security controls.</li>
              <li>Violate the WhatsApp Business Policy or Meta Platform Terms.</li>
            </ul>

            <h6 className="fw-bold text-dark mt-3">4. WhatsApp Account Ownership & Liability</h6>
            <p>
              You certify that you have the legal right and authority to connect each WhatsApp phone number paired to your account. WaCRM provides a communication interface and is not liable for account suspensions, bans, or limitations imposed by WhatsApp/Meta resulting from policy violations, spamming, or mass broadcasting.
            </p>

            <h6 className="fw-bold text-dark mt-3">5. Service Availability and Modifications</h6>
            <p>
              We strive to provide continuous platform availability. However, the service may be occasionally interrupted for scheduled maintenance, updates, or third-party WhatsApp protocol updates. We reserve the right to modify or discontinue features with appropriate notification.
            </p>

            <h6 className="fw-bold text-dark mt-3">6. Account Termination and Suspension</h6>
            <p>
              The platform administrators reserve the right to suspend or terminate accounts that violate these Terms, engage in abusive messaging, or compromise platform integrity without prior liability.
            </p>

            <h6 className="fw-bold text-dark mt-3">7. Limitation of Liability</h6>
            <p className="mb-0">
              In no event shall WaCRM, its developers, or its hosting operators be liable for indirect, incidental, punitive, or consequential damages resulting from the use or inability to use the service.
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
