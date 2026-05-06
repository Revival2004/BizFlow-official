export const BILLING_STATUSES = {
  trialing: { label: 'Trialing', tone: 'warning' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Past Due', tone: 'danger' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

export const PLATFORM_OWNER_EMAIL = 'revivalthuranira@gmail.com';
export const PLATFORM_BILLING_SUPPORT_PHONE = '0713289710';

const DEFAULT_PLAN_ENTITLEMENTS = {
  slug: 'free-trial',
  label: 'Free Trial',
  staffLimit: 7,
  canExportReports: false,
  canUseBarcodeScanner: false,
  canUseOfflineSales: true,
  canUseOfflineReports: true,
  canUseOfflineSalesHistory: true,
  featureHighlights: [
    '7 staff onboarding slots',
    'Desktop web access',
    'Offline sales and reports',
  ],
};

export const getBusinessPlan = (business) => {
  const plan = business?.current_plan || business?.billing_plans || null;
  if (plan?.slug) {
    return plan;
  }

  return null;
};

export const getPlanEntitlements = (business) => {
  const plan = getBusinessPlan(business);
  const slug = String(plan?.slug || '').trim().toLowerCase();

  if (slug === 'lifetime') {
    return {
      slug,
      label: plan?.name || 'Lifetime',
      staffLimit: null,
      canExportReports: true,
      canUseBarcodeScanner: true,
      canUseOfflineSales: true,
      canUseOfflineReports: true,
      canUseOfflineSalesHistory: true,
      featureHighlights: [
        'Unlimited staff onboarding',
        'CSV exports',
        'Barcode scanner',
        'Desktop web access',
        'Offline sales and reports',
      ],
    };
  }

  if (slug === 'beta') {
    return {
      slug,
      label: plan?.name || 'Beta',
      staffLimit: 7,
      canExportReports: false,
      canUseBarcodeScanner: false,
      canUseOfflineSales: true,
      canUseOfflineReports: true,
      canUseOfflineSalesHistory: true,
      featureHighlights: [
        '7 staff onboarding slots',
        'Desktop web access',
        'Offline sales and reports',
      ],
    };
  }

  return {
    ...DEFAULT_PLAN_ENTITLEMENTS,
    slug: slug || DEFAULT_PLAN_ENTITLEMENTS.slug,
    label: plan?.name || DEFAULT_PLAN_ENTITLEMENTS.label,
  };
};

export const getRemainingStaffSlots = (business, currentStaffCount = 0, pendingInviteCount = 0) => {
  const entitlements = getPlanEntitlements(business);
  if (entitlements.staffLimit == null) {
    return null;
  }

  return Math.max(entitlements.staffLimit - Number(currentStaffCount || 0) - Number(pendingInviteCount || 0), 0);
};

export const formatBillingAmount = (amountMinor, currency = 'KES') => {
  const safeAmount = Number(amountMinor || 0) / 100;

  try {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeAmount);
  } catch {
    return `${currency} ${safeAmount.toFixed(2)}`;
  }
};

export const formatBillingDate = (value) => {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not set';
  }

  return date.toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

export const planDurationLabel = (billingDays, { isLifetime = false, isTrial = false } = {}) => {
  if (isLifetime) {
    return 'lifetime access';
  }

  const safeDays = Number(billingDays || 0);
  if (safeDays <= 0) {
    return 'Flexible cycle';
  }

  if (isTrial) {
    return safeDays === 1 ? '1 day trial' : `${safeDays} day trial`;
  }

  return safeDays === 30 ? '30 days' : `${safeDays} days`;
};

export const normalizeBillingFeatures = (features) => {
  if (Array.isArray(features)) {
    return features.filter(Boolean).map((item) => String(item));
  }

  return [];
};

export const getBusinessBillingState = (business) => {
  if (!business) {
    return {
      isBlocked: false,
      status: 'active',
      reason: '',
    };
  }

  if (business.status && business.status !== 'active') {
    return {
      isBlocked: true,
      status: 'suspended',
      reason: 'This business is suspended. Contact BizFlow support.',
    };
  }

  const expiresAt = business.subscription_expires_at ? new Date(business.subscription_expires_at) : null;
  const baseStatus = String(business.billing_status || 'active');

  if (baseStatus === 'suspended') {
    return {
      isBlocked: true,
      status: 'suspended',
      reason: 'Billing access for this business is suspended.',
    };
  }

  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return {
      isBlocked: true,
      status: 'past_due',
      reason: 'Your business subscription has expired. Renew billing to continue.',
    };
  }

  if (baseStatus === 'past_due') {
    return {
      isBlocked: true,
      status: 'past_due',
      reason: 'Your business subscription is past due. Renew billing to continue.',
    };
  }

  return {
    isBlocked: false,
    status: baseStatus,
    reason: '',
  };
};

export const canViewPlatformOnboardings = (profile) =>
  String(profile?.email || '').trim().toLowerCase() === PLATFORM_OWNER_EMAIL;
