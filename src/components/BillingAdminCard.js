import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import { supabase } from '../utils/supabase';
import {
  BILLING_STATUSES,
  PLATFORM_BILLING_SUPPORT_PHONE,
  formatBillingAmount,
  formatBillingDate,
  getBusinessBillingState,
  normalizeBillingFeatures,
  planDurationLabel,
} from '../utils/billing';

export default function BillingAdminCard({ profile, colors, mode = 'embedded', onRefresh }) {
  const [plans, setPlans] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [verifyingCheckout, setVerifyingCheckout] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState(null);

  const fetchBilling = async () => {
    setLoading(true);

    try {
      const [{ data: planRows, error: plansError }, summaryResponse] = await Promise.all([
        supabase
          .from('billing_plans')
          .select('id, slug, name, description, amount_minor, currency, billing_days, features, is_trial, is_lifetime, is_active, sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        profile?.business_id
          ? supabase.rpc('get_business_billing_summary')
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (plansError) {
        throw plansError;
      }

      if (summaryResponse?.error) {
        throw summaryResponse.error;
      }

      const nextPlans = (planRows || []).filter((plan) => Number(plan.amount_minor || 0) > 0);
      const nextSummary = summaryResponse?.data?.success ? summaryResponse.data : null;
      const preferredPlanId =
        nextPlans.find((plan) => plan.id === nextSummary?.current_plan?.id)?.id ||
        nextPlans[0]?.id ||
        null;
      const latestPending = nextSummary?.last_checkout &&
        ['initialized', 'pending'].includes(nextSummary.last_checkout.status)
          ? {
              reference: nextSummary.last_checkout.reference,
              authorizationUrl: nextSummary.last_checkout.authorization_url,
            }
          : null;

      setPlans(nextPlans);
      setSummary(nextSummary);
      setSelectedPlanId((current) => current || preferredPlanId);
      setPendingCheckout(latestPending);
    } catch (error) {
      Alert.alert('Billing Error', error.message || 'Could not load billing details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBilling();
  }, [profile?.business_id]);

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) || plans[0] || null;
  const businessBilling = getBusinessBillingState(profile?.businesses);
  const currentPlanId = summary?.current_plan?.id || null;

  const openCheckout = async (authorizationUrl) => {
    if (!authorizationUrl) {
      Alert.alert('Billing Error', 'Paystack did not return a checkout link.');
      return;
    }

    try {
      await ExpoLinking.openURL(authorizationUrl);
    } catch (_error) {
      Alert.alert('Open Browser Failed', 'Copy the link later or try again from a device with a browser.');
    }
  };

  const startRenewalCheckout = async () => {
    if (!selectedPlan) {
      Alert.alert('Choose a Plan', 'Select a billing plan before continuing.');
      return;
    }

    setStartingCheckout(true);

    try {
      const { data, error } = await supabase.functions.invoke('paystack-initialize-billing', {
        body: {
          intent: currentPlanId && currentPlanId !== selectedPlan.id ? 'upgrade' : 'renewal',
          planSlug: selectedPlan.slug,
        },
      });

      if (error) {
        throw new Error(error.message || 'Could not start the Paystack checkout.');
      }

      if (!data?.success || !data?.authorizationUrl) {
        throw new Error(data?.error || 'Paystack did not return a checkout URL.');
      }

      const nextPending = {
        reference: data.reference,
        authorizationUrl: data.authorizationUrl,
      };

      setPendingCheckout(nextPending);
      await openCheckout(data.authorizationUrl);
    } catch (error) {
      Alert.alert('Billing Error', error.message || 'Could not start the Paystack checkout.');
    } finally {
      setStartingCheckout(false);
    }
  };

  const verifyPendingCheckout = async () => {
    if (!pendingCheckout?.reference) {
      Alert.alert('Nothing to Verify', 'Start a Paystack checkout first.');
      return;
    }

    setVerifyingCheckout(true);

    try {
      const { data, error } = await supabase.functions.invoke('paystack-verify-billing', {
        body: { reference: pendingCheckout.reference },
      });

      if (error) {
        throw new Error(error.message || 'Could not verify this billing payment.');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Could not verify this billing payment.');
      }

      if (data?.paymentStatus !== 'paid') {
        Alert.alert('Payment Pending', data?.message || 'The payment is not complete yet. Finish it on Paystack, then verify again.');
        return;
      }

      setPendingCheckout(null);
      await fetchBilling();
      if (onRefresh) {
        await onRefresh();
      }
      Alert.alert('Billing Updated', 'Your business subscription is active again.');
    } catch (error) {
      Alert.alert('Verification Failed', error.message || 'Could not verify this billing payment.');
    } finally {
      setVerifyingCheckout(false);
    }
  };

  const statusMeta = BILLING_STATUSES[summary?.billing_status || businessBilling.status] || BILLING_STATUSES.active;
  const accentColor = colors[statusMeta.tone] || colors.secondary;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 20,
        padding: 18,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontSize: mode === 'gate' ? 22 : 17, fontWeight: '800', color: colors.text }}>
            {mode === 'gate' ? 'Renew BizFlow Billing' : 'Business Billing'}
          </Text>
          <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 4, lineHeight: 18 }}>
            {mode === 'gate'
              ? 'Only your business admin can restore access. Renew the plan on Paystack, then verify the payment here.'
              : 'Every business starts with a 7-day free trial. Upgrade here later to keep BizFlow running without interruption.'}
          </Text>
        </View>
        <View style={{ backgroundColor: accentColor + '15', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ color: accentColor, fontSize: 11, fontWeight: '800' }}>{statusMeta.label.toUpperCase()}</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.secondary} style={{ marginVertical: 28 }} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
            <View style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 14, padding: 12 }}>
              <Text style={{ fontSize: 11, color: colors.textLight, fontWeight: '700', marginBottom: 4 }}>Current Plan</Text>
              <Text style={{ fontSize: 15, color: colors.text, fontWeight: '800' }}>
                {summary?.current_plan?.name || 'Not set'}
              </Text>
            </View>
            <View style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 14, padding: 12 }}>
              <Text style={{ fontSize: 11, color: colors.textLight, fontWeight: '700', marginBottom: 4 }}>Access Until</Text>
              <Text style={{ fontSize: 15, color: colors.text, fontWeight: '800' }}>
                {formatBillingDate(summary?.subscription_expires_at || profile?.businesses?.subscription_expires_at)}
              </Text>
            </View>
          </View>

          <View style={{ backgroundColor: colors.bg, borderRadius: 14, padding: 14, marginBottom: 14 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 6 }}>Choose a plan</Text>
            <Text style={{ fontSize: 12, color: colors.textLight, lineHeight: 18 }}>
              Paystack charges into your platform billing account. Beta is the monthly plan, and Lifetime is a one-time purchase.
            </Text>
            <Text style={{ fontSize: 12, color: colors.textLight, lineHeight: 18, marginTop: 8 }}>
              Need billing help? Contact {PLATFORM_BILLING_SUPPORT_PHONE}.
            </Text>
          </View>

          {plans.map((plan) => {
            const isSelected = plan.id === selectedPlanId;
            const features = normalizeBillingFeatures(plan.features);
            const durationLabel = planDurationLabel(plan.billing_days, {
              isLifetime: plan.is_lifetime,
              isTrial: plan.is_trial,
            });
            return (
              <TouchableOpacity
                key={plan.id}
                activeOpacity={0.85}
                onPress={() => setSelectedPlanId(plan.id)}
                style={{
                  borderWidth: 1.5,
                  borderColor: isSelected ? colors.secondary : colors.border,
                  backgroundColor: isSelected ? colors.secondary + '10' : colors.card,
                  borderRadius: 16,
                  padding: 14,
                  marginBottom: 10,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{plan.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 4, lineHeight: 18 }}>
                      {plan.description || 'BizFlow business subscription'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: colors.secondary }}>
                      {formatBillingAmount(plan.amount_minor, plan.currency)}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 3 }}>
                      {plan.is_lifetime ? durationLabel : `per ${durationLabel}`}
                    </Text>
                  </View>
                </View>

                {features.length > 0 ? (
                  <View style={{ marginTop: 10 }}>
                    {features.slice(0, 4).map((feature) => (
                      <View key={feature} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.secondary, marginRight: 8 }} />
                        <Text style={{ fontSize: 12, color: colors.textLight, flex: 1 }}>{feature}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}

          {pendingCheckout ? (
            <View style={{ backgroundColor: colors.bg, borderRadius: 16, padding: 14, marginTop: 4 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 6 }}>Pending Paystack Checkout</Text>
              <Text style={{ fontSize: 12, color: colors.textLight, lineHeight: 18 }}>
                Open the Paystack page, finish the payment, then verify it here.
              </Text>
              <Text selectable style={{ fontSize: 11, color: colors.secondary, marginTop: 10 }}>
                Reference: {pendingCheckout.reference}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    borderWidth: 1.5,
                    borderColor: colors.secondary,
                    borderRadius: 12,
                    height: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onPress={() => openCheckout(pendingCheckout.authorizationUrl)}
                >
                  <Text style={{ color: colors.secondary, fontWeight: '700' }}>Open Checkout</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    backgroundColor: colors.secondary,
                    borderRadius: 12,
                    height: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onPress={verifyPendingCheckout}
                  disabled={verifyingCheckout}
                >
                  {verifyingCheckout ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Verify Payment</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <TouchableOpacity
            style={{
              backgroundColor: colors.secondary,
              borderRadius: 14,
              height: 50,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 16,
            }}
            onPress={startRenewalCheckout}
            disabled={startingCheckout}
          >
            {startingCheckout ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
                {summary?.is_access_active ? 'Continue to Paystack' : 'Restore Access with Paystack'}
              </Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}
