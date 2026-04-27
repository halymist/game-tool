// ==================== Coupon Designer ====================

(function () {
    const state = {
        initialized: false,
        coupons: [],
    };

    function qs(id) {
        return document.getElementById(id);
    }

    function escHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>\"']/g, (c) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[c]);
    }

    function formatDate(isoLike) {
        if (!isoLike) return '-';
        const d = new Date(isoLike);
        if (isNaN(d.getTime())) return '-';
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function formatDateTime(isoLike) {
        if (!isoLike) return '-';
        const d = new Date(isoLike);
        if (isNaN(d.getTime())) return '-';
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    }

    function toDateOnlyMs(value) {
        const d = new Date(value);
        if (isNaN(d.getTime())) return NaN;
        return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function daysRemaining(expiresAt) {
        const expiryMs = toDateOnlyMs(expiresAt);
        if (!isFinite(expiryMs)) return null;
        const now = new Date();
        const nowMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        return Math.floor((expiryMs - nowMs) / 86400000);
    }

    function setStatus(message, tone) {
        const statusEl = qs('couponStatus');
        if (!statusEl) return;
        statusEl.textContent = message || '';
        statusEl.classList.remove('success', 'error');
        if (tone === 'success' || tone === 'error') {
            statusEl.classList.add(tone);
        }
    }

    function generateCode(length = 12) {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const out = [];
        const random = new Uint8Array(length);
        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(random);
            for (let i = 0; i < random.length; i++) {
                out.push(alphabet[random[i] % alphabet.length]);
            }
        } else {
            for (let i = 0; i < length; i++) {
                out.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
            }
        }
        return out.join('');
    }

    async function apiFetch(url, opts = {}) {
        const token = await getCurrentAccessToken();
        if (!token) throw new Error('Auth required');
        const headers = {
            'Authorization': `Bearer ${token}`,
            ...(opts.headers || {}),
        };
        const response = await fetch(url, { ...opts, headers });
        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
        if (!response.ok) {
            const msg = payload?.message || `HTTP ${response.status}`;
            throw new Error(msg);
        }
        if (!payload?.success) {
            throw new Error(payload?.message || 'Request failed');
        }
        return payload;
    }

    function renderCouponTable() {
        const body = qs('couponTableBody');
        if (!body) return;

        if (!state.coupons.length) {
            body.innerHTML = '<tr><td colspan="6" class="coupon-empty">No coupons found</td></tr>';
            return;
        }

        body.innerHTML = state.coupons.map((coupon) => {
            const remaining = daysRemaining(coupon.expires_at);
            const endsIn = remaining == null
                ? '-'
                : (remaining >= 0 ? `${remaining}` : `${remaining}`);
            const rowClass = coupon.is_active ? 'coupon-row-active' : 'coupon-row-expired';
            const activeLabel = coupon.is_active ? 'Active' : 'Expired';
            return `
                <tr class="${rowClass}">
                    <td>${coupon.id}</td>
                    <td class="coupon-code-cell">${escHtml(coupon.code)}</td>
                    <td>${formatDate(coupon.expires_at)}</td>
                    <td>
                        <span class="coupon-days ${coupon.is_active ? 'coupon-days-active' : 'coupon-days-expired'}">${endsIn}</span>
                        <span class="coupon-state-label">${activeLabel}</span>
                    </td>
                    <td>${formatDateTime(coupon.created_at)}</td>
                    <td>
                        <button type="button" class="btn-coupon-disable" data-coupon-id="${coupon.id}">Remove</button>
                    </td>
                </tr>
            `;
        }).join('');

        body.querySelectorAll('.btn-coupon-disable').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.dataset.couponId, 10);
                if (!id) return;
                await deleteCoupon(id);
            });
        });
    }

    async function loadCouponData() {
        try {
            const payload = await apiFetch('/api/getCoupons');
            state.coupons = Array.isArray(payload.coupons) ? payload.coupons : [];
            renderCouponTable();
        } catch (err) {
            setStatus(err.message || 'Failed to load coupons', 'error');
            const body = qs('couponTableBody');
            if (body) {
                body.innerHTML = '<tr><td colspan="6" class="coupon-empty">Failed to load coupons</td></tr>';
            }
        }
    }

    async function createCoupon(event) {
        if (event) event.preventDefault();

        const codeInput = qs('couponCodeInput');
        const expiryInput = qs('couponExpiryInput');
        const createBtn = qs('couponCreateBtn');
        if (!codeInput || !expiryInput || !createBtn) return;

        const expiresAt = expiryInput.value;
        if (!expiresAt) {
            setStatus('Expiration date is required.', 'error');
            return;
        }

        const code = (codeInput.value || '').trim().toUpperCase();
        const payload = {
            code: code || null,
            expiresAt,
        };

        createBtn.disabled = true;
        setStatus('Creating coupon…');
        try {
            await apiFetch('/api/createCoupon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            setStatus('Coupon created.', 'success');
            codeInput.value = '';
            await loadCouponData();
        } catch (err) {
            setStatus(err.message || 'Failed to create coupon', 'error');
        } finally {
            createBtn.disabled = false;
        }
    }

    async function deleteCoupon(id) {
        if (!confirm(`Remove coupon #${id}?`)) return;

        setStatus('Removing coupon…');
        try {
            await apiFetch('/api/deleteCoupon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });
            setStatus('Coupon removed.', 'success');
            await loadCouponData();
        } catch (err) {
            setStatus(err.message || 'Failed to remove coupon', 'error');
        }
    }

    function setDefaultExpiry() {
        const expiryInput = qs('couponExpiryInput');
        if (!expiryInput || expiryInput.value) return;
        const now = new Date();
        now.setDate(now.getDate() + 30);
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        expiryInput.value = `${yyyy}-${mm}-${dd}`;
    }

    function initCouponManager() {
        if (state.initialized) return;

        const form = qs('couponCreateForm');
        const generateBtn = qs('couponGenerateBtn');
        const codeInput = qs('couponCodeInput');

        if (!form || !generateBtn || !codeInput) return;

        form.addEventListener('submit', createCoupon);
        generateBtn.addEventListener('click', () => {
            codeInput.value = generateCode(12);
            codeInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        codeInput.addEventListener('blur', () => {
            codeInput.value = (codeInput.value || '').toUpperCase().trim();
        });

        setDefaultExpiry();
        state.initialized = true;
    }

    window.initCouponManager = initCouponManager;
    window.loadCouponData = loadCouponData;
})();
