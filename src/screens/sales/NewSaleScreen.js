import React, { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  TextInput, Alert, Modal, ActivityIndicator, ScrollView,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fmt } from '../../utils/constants';
import { saveOfflineSale, cacheProducts, getCachedProducts, syncOfflineData } from '../../utils/offline';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { cleanObject, cleanText } from '../../utils/textEncoding';
import {
  formatKenyanPhoneInput,
  isValidKenyanPhone,
  normalizeKenyanPhone,
} from '../../utils/mpesa';

function LowStockToast({ message, trigger }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!trigger || !message) {
      return;
    }

    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [message, opacity, trigger]);

  return (
    <Animated.View
      style={{
        opacity,
        position: 'absolute',
        bottom: 80,
        left: 16,
        right: 16,
        backgroundColor: '#F59F00',
        borderRadius: 12,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        zIndex: 999,
        elevation: 10,
      }}
    >
      <Ionicons name="warning" size={18} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13, flex: 1 }}>{message}</Text>
    </Animated.View>
  );
}

const PAYMENT_OPTIONS = [
  { key: 'cash', label: 'Cash', icon: 'cash' },
  { key: 'card', label: 'Card', icon: 'card' },
  { key: 'transfer', label: 'Transfer', icon: 'swap-horizontal' },
  { key: 'mpesa', label: 'M-Pesa', icon: 'phone-portrait' },
];

export default function NewSaleScreen({ navigation }) {
  const { profile, hasPermission } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const syncInProgressRef = useRef(false);
  const processingRef = useRef(false);
  const fetchRequestRef = useRef(0);
  const mpesaPollInFlightRef = useRef(false);
  const pendingMpesaRef = useRef(null);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const [toast, setToast] = useState({ message: '', trigger: 0 });
  const [mpesaCheckoutLoading, setMpesaCheckoutLoading] = useState(false);
  const [mpesaCheckout, setMpesaCheckout] = useState(null);
  const [pendingMpesa, setPendingMpesa] = useState(null);
  const deferredSearch = useDeferredValue(search);

  const canCreateSale = hasPermission('create_sale');
  const mpesaEnabled = Boolean(mpesaCheckout?.configured && mpesaCheckout?.enabled);
  const cartLocked = processing || Boolean(pendingMpesa);

  useEffect(() => {
    pendingMpesaRef.current = pendingMpesa;
  }, [pendingMpesa]);

  useEffect(() => {
    if (!profile?.business_id || !profile?.id) {
      setLoading(false);
      return undefined;
    }

    let mounted = true;

    const syncPendingSales = async () => {
      if (syncInProgressRef.current || !profile?.business_id || !profile?.id) {
        return;
      }

      syncInProgressRef.current = true;

      try {
        const result = await syncOfflineData(profile.business_id, profile.id);

        if (result.synced > 0 && mounted) {
          await fetchProducts(false);
          Alert.alert(
            'Offline Sales Synced',
            `${result.synced} saved sale${result.synced === 1 ? '' : 's'} uploaded to the cloud.`,
          );
        }

        if (result.failed > 0 && mounted) {
          showToast(`${result.failed} offline sale${result.failed === 1 ? '' : 's'} still waiting to sync`);
        }
      } finally {
        syncInProgressRef.current = false;
      }
    };

    const init = async () => {
      const state = await NetInfo.fetch();
      const offline = !state.isConnected;
      if (mounted) {
        setIsOffline(offline);
      }
      await Promise.all([
        fetchProducts(offline),
        fetchMpesaCheckoutStatus(),
      ]);
      if (!offline) {
        await syncPendingSales();
      }
    };

    init();

    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline = !state.isConnected;
      setIsOffline(offline);

      if (!offline) {
        syncPendingSales();
        fetchProducts(false);
        fetchMpesaCheckoutStatus();
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [canCreateSale, profile?.business_id, profile?.id]);

  useEffect(() => {
    if (!pendingMpesa?.id || isOffline) {
      return undefined;
    }

    checkPendingMpesaStatus(pendingMpesa.id, { silent: true });
    const interval = setInterval(() => {
      checkPendingMpesaStatus(pendingMpesa.id, { silent: true });
    }, 4000);

    return () => clearInterval(interval);
  }, [isOffline, pendingMpesa?.id]);

  const showToast = (message) => {
    setToast({ message, trigger: Date.now() });
  };

  const fetchMpesaCheckoutStatus = async () => {
    if (!profile?.business_id || !canCreateSale) {
      startTransition(() => {
        setMpesaCheckout(null);
      });
      return;
    }

    setMpesaCheckoutLoading(true);

    try {
      const { data, error } = await supabase.rpc('get_mpesa_checkout_status');

      if (error) {
        throw error;
      }

      startTransition(() => {
        setMpesaCheckout(data || null);
      });
    } catch (_error) {
      startTransition(() => {
        setMpesaCheckout(null);
      });
    } finally {
      setMpesaCheckoutLoading(false);
    }
  };

  const fetchProducts = async (offlineOverride = isOffline) => {
    setLoading(true);
    const requestId = Date.now();
    fetchRequestRef.current = requestId;

    try {
      if (offlineOverride) {
        const cached = await getCachedProducts();
        if (cached) {
          if (fetchRequestRef.current === requestId) {
            startTransition(() => {
              setProducts(cleanObject(cached));
            });
          }
          return;
        }
      }

      const { data, error } = await supabase
        .from('products')
        .select('*, categories(name)')
        .eq('business_id', profile.business_id)
        .eq('is_active', true)
        .order('name');

      if (error) {
        throw error;
      }

      const cleanedProducts = cleanObject(data || []);
      if (fetchRequestRef.current === requestId) {
        startTransition(() => {
          setProducts(cleanedProducts);
        });
      }
      await cacheProducts(cleanedProducts);
    } catch {
      const cached = await getCachedProducts();
      if (cached && fetchRequestRef.current === requestId) {
        startTransition(() => {
          setProducts(cleanObject(cached));
        });
      }
    } finally {
      if (fetchRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  useRealtimeRefresh({
    enabled: Boolean(profile?.business_id) && !isOffline,
    channelName: `new-sale:${profile?.business_id}`,
    bindings: [
      {
        event: '*',
        schema: 'public',
        table: 'products',
        filter: `business_id=eq.${profile?.business_id}`,
      },
      {
        event: '*',
        schema: 'public',
        table: 'business_payment_settings',
        filter: `business_id=eq.${profile?.business_id}`,
      },
    ],
    onChange: () => {
      fetchProducts(false);
      fetchMpesaCheckoutStatus();
    },
  });

  const searchTerm = cleanText(deferredSearch || '').toLowerCase();
  const filtered = products.filter((product) =>
    cleanText(product.name || '').toLowerCase().includes(searchTerm) ||
    cleanText(product.sku || '').toLowerCase().includes(searchTerm),
  );

  const addToCart = (product) => {
    if (cartLocked) {
      return;
    }

    const productName = cleanText(product.name || 'This product');

    if (product.quantity === 0) {
      Alert.alert('Out of Stock', `${productName} is out of stock.`);
      return;
    }

    let limitReached = false;

    setCart((currentCart) => {
      const existing = currentCart.find((entry) => entry.id === product.id);
      if (existing) {
        if (existing.qty >= product.quantity) {
          limitReached = true;
          return currentCart;
        }

        return currentCart.map((entry) => (
          entry.id === product.id ? { ...entry, qty: entry.qty + 1 } : entry
        ));
      }

      return [...currentCart, { ...product, qty: 1 }];
    });

    if (limitReached) {
      Alert.alert('Stock Limit', `Only ${product.quantity} units are available.`);
      return;
    }

    if (product.quantity <= product.reorder_level + 2) {
      showToast(`Low stock: ${productName} (${product.quantity} left)`);
    }
  };

  const removeFromCart = (id) => {
    if (cartLocked) {
      return;
    }

    setCart((currentCart) => currentCart.filter((entry) => entry.id !== id));
  };

  const updateQty = (id, qty) => {
    if (cartLocked) {
      return;
    }

    const product = products.find((entry) => entry.id === id);
    const newQty = parseInt(qty, 10) || 0;

    if (newQty <= 0) {
      removeFromCart(id);
      return;
    }

    if (product && newQty > product.quantity) {
      Alert.alert('Stock Limit', `Only ${product.quantity} available.`);
      return;
    }

    setCart((currentCart) => currentCart.map((entry) => (entry.id === id ? { ...entry, qty: newQty } : entry)));
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.selling_price * item.qty), 0);
  const totalCost = cart.reduce((sum, item) => sum + (item.cost_price * item.qty), 0);
  const profit = subtotal - totalCost;
  const change = parseFloat(amountTendered || 0) - subtotal;

  const resetSaleDraft = () => {
    setCart([]);
    setAmountTendered('');
    setCustomerName('');
    setCustomerPhone('');
  };

  const checkPendingMpesaStatus = async (intentId, { silent = false } = {}) => {
    if (!intentId || mpesaPollInFlightRef.current) {
      return;
    }

    mpesaPollInFlightRef.current = true;

    try {
      const { data, error } = await supabase
        .from('payment_intents')
        .select('id, status, reference_number, mpesa_receipt_number, mpesa_result_desc, error_message, sale_id')
        .eq('id', intentId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return;
      }

      setPendingMpesa((current) => (
        current && current.id === intentId
          ? {
              ...current,
              status: data.status,
              receiptNumber: data.mpesa_receipt_number || current.receiptNumber || null,
            }
          : current
      ));

      if (data.status === 'completed') {
        const completedPayment = pendingMpesaRef.current;
        setPendingMpesa(null);
        await fetchProducts(false);
        resetSaleDraft();
        Alert.alert(
          'M-Pesa Complete',
          `Ref: ${data.reference_number || completedPayment?.referenceNumber || ''}\nTotal: ${fmt(completedPayment?.amount || subtotal)}${data.mpesa_receipt_number ? `\nReceipt: ${data.mpesa_receipt_number}` : ''}`,
          [{ text: 'New Sale' }, { text: 'Back', onPress: () => navigation.goBack() }],
        );
        return;
      }

      if (['failed', 'cancelled', 'expired'].includes(data.status)) {
        setPendingMpesa(null);
        Alert.alert(
          'M-Pesa Not Completed',
          data.error_message || data.mpesa_result_desc || 'The M-Pesa payment was not completed. You can try again or choose another payment method.',
        );
        return;
      }

      if (data.status === 'paid' && data.error_message) {
        setPendingMpesa(null);
        Alert.alert(
          'Payment Needs Review',
          `The customer payment was received, but BizFlow could not finish the sale automatically.\n\n${data.error_message}`,
        );
      }
    } catch (error) {
      if (!silent) {
        Alert.alert('M-Pesa Status Error', error.message);
      }
    } finally {
      mpesaPollInFlightRef.current = false;
    }
  };

  const initiateMpesaSale = async ({ ref, salePayload, itemsPayload }) => {
    if (mpesaCheckoutLoading) {
      Alert.alert('M-Pesa Loading', 'BizFlow is still checking this business payment setup. Please try again in a moment.');
      return;
    }

    if (!mpesaEnabled) {
      Alert.alert('M-Pesa Unavailable', 'This business has not enabled M-Pesa checkout yet. Ask the business admin to finish the M-Pesa setup first.');
      return;
    }

    if (!isValidKenyanPhone(customerPhone)) {
      Alert.alert('Phone Required', 'Enter a valid Safaricom number like 07XXXXXXXX or 2547XXXXXXXX.');
      return;
    }

    const normalizedPhone = normalizeKenyanPhone(customerPhone);

    const { data, error } = await supabase.functions.invoke('mpesa-initiate-payment', {
      body: {
        referenceNumber: ref,
        customerName: salePayload.customer_name,
        customerPhone: normalizedPhone,
        totalAmount: salePayload.total_amount,
        costTotal: salePayload.cost_total,
        profit: salePayload.profit,
        notes: salePayload.notes,
        items: itemsPayload,
      },
    });

    if (error) {
      throw error;
    }

    if (!data?.success) {
      throw new Error(data?.error || 'BizFlow could not start the M-Pesa payment.');
    }

    setPendingMpesa({
      id: data.intentId,
      referenceNumber: data.referenceNumber || ref,
      amount: salePayload.total_amount,
      phone: normalizedPhone,
      status: 'initiated',
      receiptNumber: null,
      startedAt: Date.now(),
    });
    setPaymentModal(false);
    setAmountTendered('');

    Alert.alert(
      'STK Push Sent',
      data.customerMessage || 'Ask the customer to enter their M-Pesa PIN. BizFlow will complete the sale automatically once payment is confirmed.',
    );
  };

  const processSale = async () => {
    if (processingRef.current || cartLocked) {
      return;
    }

    if (cart.length === 0) {
      Alert.alert('Empty Cart', 'Add items first.');
      return;
    }

    if (paymentMethod === 'cash' && parseFloat(amountTendered || 0) < subtotal) {
      Alert.alert('Insufficient', `Amount entered is less than ${fmt(subtotal)}.`);
      return;
    }

    processingRef.current = true;
    setProcessing(true);
    const ref = `SALE-${Date.now().toString().slice(-8)}`;
    const cleanedCustomerName = cleanText(customerName || '').trim();

    const salePayload = {
      reference_number: ref,
      business_id: profile.business_id,
      sold_by: profile.id,
      customer_name: cleanedCustomerName || null,
      customer_phone: paymentMethod === 'mpesa' ? normalizeKenyanPhone(customerPhone) || null : null,
      total_amount: subtotal,
      cost_total: totalCost,
      profit,
      payment_method: paymentMethod,
      amount_tendered: paymentMethod === 'cash' ? parseFloat(amountTendered) : subtotal,
      change_given: paymentMethod === 'cash' ? Math.max(0, change) : 0,
      status: 'completed',
      items_count: cart.reduce((sum, item) => sum + item.qty, 0),
      notes: null,
    };

    const itemsPayload = cart.map((item) => ({
      product_id: item.id,
      product_name: cleanText(item.name || ''),
      quantity: item.qty,
      unit_price: item.selling_price,
      cost_price: item.cost_price,
      total_price: item.selling_price * item.qty,
      profit: (item.selling_price - item.cost_price) * item.qty,
      discount: 0,
    }));

    try {
      const netState = await NetInfo.fetch();
      if (paymentMethod === 'mpesa') {
        if (!netState.isConnected) {
          Alert.alert('Internet Required', 'M-Pesa checkout needs a live internet connection.');
          return;
        }

        await initiateMpesaSale({ ref, salePayload, itemsPayload });
        return;
      }

      if (!netState.isConnected) {
        const cartById = new Map(cart.map((item) => [item.id, item]));
        const nextProducts = products.map((product) => {
          const cartItem = cartById.get(product.id);
          return cartItem ? { ...product, quantity: product.quantity - cartItem.qty } : product;
        });

        await saveOfflineSale(salePayload, itemsPayload);
        startTransition(() => {
          setProducts(nextProducts);
        });
        await cacheProducts(nextProducts);

        setPaymentModal(false);
        resetSaleDraft();
        Alert.alert('Sale Saved Offline', `Ref: ${ref}\nThis sale will sync to the cloud when you reconnect.`, [{ text: 'OK' }]);
        return;
      }

      const { data: result, error: saleError } = await supabase.rpc('process_sale', {
        p_business_id: profile.business_id,
        p_reference_number: ref,
        p_sold_by: profile.id,
        p_customer_name: salePayload.customer_name,
        p_customer_phone: salePayload.customer_phone,
        p_total_amount: salePayload.total_amount,
        p_cost_total: salePayload.cost_total,
        p_profit: salePayload.profit,
        p_payment_method: salePayload.payment_method,
        p_amount_tendered: salePayload.amount_tendered,
        p_change_given: salePayload.change_given,
        p_notes: salePayload.notes,
        p_items: itemsPayload,
      });

      if (saleError) {
        throw saleError;
      }

      if (!result?.success) {
        throw new Error(result?.error || 'Sale could not be completed.');
      }

      for (const item of cart) {
        const newQty = item.quantity - item.qty;
        if (newQty <= item.reorder_level && newQty > 0) {
          showToast(`Low stock: ${item.name} now has ${newQty} ${item.unit} left`);
        }
      }

      setPaymentModal(false);
      resetSaleDraft();
      await fetchProducts(false);

      Alert.alert(
        'Sale Complete',
        `Ref: ${ref}\nTotal: ${fmt(subtotal)}${paymentMethod === 'cash' ? `\nChange: ${fmt(Math.max(0, change))}` : ''}`,
        [{ text: 'New Sale' }, { text: 'Back', onPress: () => navigation.goBack() }],
      );
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
      {isOffline && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#F59F00', padding: 6, alignItems: 'center', zIndex: 10 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
            Offline Mode - sales will sync when reconnected.
          </Text>
        </View>
      )}

      <View style={{ flex: 1.2, padding: 12, paddingTop: isOffline ? 36 : 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border, height: 42 }}>
          <Ionicons name="search" size={18} color={colors.textLight} />
          <TextInput
            style={{ flex: 1, marginLeft: 8, fontSize: 14, color: colors.text }}
            placeholder="Search products or SKU..."
            value={search}
            onChangeText={setSearch}
            placeholderTextColor={colors.textLight}
          />
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          numColumns={2}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={8}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          columnWrapperStyle={{ gap: 8, marginBottom: 8 }}
          renderItem={({ item }) => {
            const disabled = cartLocked || item.quantity === 0;
            return (
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: colors.card,
                  borderRadius: 12,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: item.quantity === 0 ? colors.danger + '40' : colors.border,
                  opacity: disabled ? 0.5 : 1,
                }}
                onPress={() => addToCart(item)}
                activeOpacity={0.7}
                disabled={disabled}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 }} numberOfLines={2}>
                  {cleanText(item.name || '')}
                </Text>
                <Text style={{ fontSize: 15, fontWeight: '800', color: colors.secondary }}>{fmt(item.selling_price)}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ fontSize: 10, color: item.quantity <= item.reorder_level ? colors.warning : colors.textLight }}>
                    {item.quantity === 0 ? 'OUT OF STOCK' : `${item.quantity} ${item.unit}`}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <View style={{ flex: 1, backgroundColor: colors.card, borderLeftWidth: 1, borderLeftColor: colors.border, padding: 12, paddingBottom: 12 + insets.bottom }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 8 }}>
          Cart ({cart.length})
        </Text>

        {pendingMpesa && (
          <View style={{ backgroundColor: colors.secondary + '12', borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.secondary + '40' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={colors.secondary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>
                  {pendingMpesa.status === 'paid' ? 'Payment received, finalizing sale...' : 'Waiting for M-Pesa confirmation'}
                </Text>
                <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 3 }}>
                  Ref {pendingMpesa.referenceNumber} {pendingMpesa.phone ? `for ${pendingMpesa.phone}` : ''}
                </Text>
                <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 2 }}>
                  {isOffline
                    ? 'Reconnect to keep checking the payment result.'
                    : 'Ask the customer to approve the STK push on their phone.'}
                </Text>
              </View>
              <TouchableOpacity
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.card }}
                onPress={() => checkPendingMpesaStatus(pendingMpesa.id)}
              >
                <Text style={{ color: colors.secondary, fontWeight: '700', fontSize: 12 }}>Refresh</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TextInput
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, height: 36, fontSize: 13, marginBottom: 8, color: colors.text, backgroundColor: colors.inputBg, opacity: cartLocked ? 0.6 : 1 }}
          placeholder="Customer name (optional)"
          value={customerName}
          onChangeText={setCustomerName}
          placeholderTextColor={colors.textLight}
          editable={!cartLocked}
        />

        <ScrollView style={{ flex: 1 }}>
          {cart.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 32 }}>
              <Ionicons name="cart-outline" size={48} color={colors.textLight} />
              <Text style={{ color: colors.textLight, marginTop: 8 }}>Tap a product to add</Text>
            </View>
          ) : (
            cart.map((item) => (
              <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text }} numberOfLines={1}>
                    {cleanText(item.name || '')}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.textLight }}>{fmt(item.selling_price)}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <TouchableOpacity
                    onPress={() => updateQty(item.id, item.qty - 1)}
                    style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', opacity: cartLocked ? 0.5 : 1 }}
                    disabled={cartLocked}
                  >
                    <Ionicons name="remove" size={14} color={colors.secondary} />
                  </TouchableOpacity>
                  <Text style={{ width: 28, textAlign: 'center', fontWeight: '700', color: colors.text }}>{item.qty}</Text>
                  <TouchableOpacity
                    onPress={() => updateQty(item.id, item.qty + 1)}
                    style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', opacity: cartLocked ? 0.5 : 1 }}
                    disabled={cartLocked}
                  >
                    <Ionicons name="add" size={14} color={colors.secondary} />
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, minWidth: 52, textAlign: 'right' }}>
                  {fmt(item.selling_price * item.qty)}
                </Text>
                <TouchableOpacity onPress={() => removeFromCart(item.id)} disabled={cartLocked} style={{ opacity: cartLocked ? 0.5 : 1 }}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>

        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>TOTAL</Text>
            <Text style={{ fontSize: 20, fontWeight: '900', color: colors.secondary }}>{fmt(subtotal)}</Text>
          </View>
          <TouchableOpacity
            style={{ backgroundColor: cart.length === 0 || cartLocked ? colors.textLight : colors.secondary, borderRadius: 12, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onPress={() => setPaymentModal(true)}
            disabled={cart.length === 0 || cartLocked}
            activeOpacity={0.8}
          >
            <Ionicons name={pendingMpesa ? 'time' : 'card'} size={20} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
              {pendingMpesa ? 'Waiting for M-Pesa' : `Charge ${fmt(subtotal)}`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={paymentModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, paddingBottom: 28 + insets.bottom }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' }}>
              Complete Sale
            </Text>
            <Text style={{ fontSize: 40, fontWeight: '900', color: colors.secondary, textAlign: 'center', marginVertical: 8 }}>
              {fmt(subtotal)}
            </Text>

            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: 12 }}>
              Payment Method
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {PAYMENT_OPTIONS.map((method) => {
                const disabled = method.key === 'mpesa' && !mpesaEnabled;
                return (
                  <TouchableOpacity
                    key={method.key}
                    style={{
                      width: '47.5%',
                      borderWidth: 2,
                      borderColor: paymentMethod === method.key ? colors.secondary : colors.border,
                      borderRadius: 10,
                      padding: 10,
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: paymentMethod === method.key ? colors.secondary : 'transparent',
                      opacity: disabled ? 0.45 : 1,
                    }}
                    onPress={() => {
                      if (disabled) {
                        Alert.alert('M-Pesa Unavailable', 'This business has not enabled M-Pesa checkout yet.');
                        return;
                      }
                      setPaymentMethod(method.key);
                    }}
                    disabled={disabled}
                  >
                    <Ionicons
                      name={method.icon}
                      size={20}
                      color={paymentMethod === method.key ? '#fff' : colors.secondary}
                    />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: paymentMethod === method.key ? '#fff' : colors.secondary }}>
                      {method.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {paymentMethod === 'mpesa' && (
              <>
                <View style={{ backgroundColor: colors.secondary + '10', borderRadius: 12, padding: 12, marginBottom: 12 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Business M-Pesa Checkout</Text>
                  <Text style={{ color: colors.textLight, fontSize: 12, lineHeight: 18, marginTop: 4 }}>
                    {mpesaEnabled
                      ? 'BizFlow will send an STK push to the customer phone, then complete the sale automatically after Safaricom confirms payment.'
                      : 'A business admin must enable M-Pesa in Profile -> Payments before this method can be used.'}
                  </Text>
                  {mpesaCheckout?.shortcode_hint ? (
                    <Text style={{ color: colors.textLight, fontSize: 11, marginTop: 6 }}>
                      Shortcode: {mpesaCheckout.shortcode_hint}
                    </Text>
                  ) : null}
                </View>

                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8 }}>
                  Customer Phone Number
                </Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, height: 56, fontSize: 18, fontWeight: '700', color: colors.text, backgroundColor: colors.inputBg, marginBottom: 8 }}
                  placeholder="07XXXXXXXX"
                  value={customerPhone}
                  onChangeText={(value) => setCustomerPhone(formatKenyanPhoneInput(value))}
                  keyboardType="phone-pad"
                  placeholderTextColor={colors.textLight}
                  autoFocus
                />
                <Text style={{ fontSize: 11, color: colors.textLight, marginBottom: 8 }}>
                  Safaricom format only. BizFlow accepts 07XXXXXXXX or 2547XXXXXXXX.
                </Text>
              </>
            )}

            {paymentMethod === 'cash' && (
              <>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8 }}>
                  Amount Tendered (KES)
                </Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, height: 56, fontSize: 24, fontWeight: '700', color: colors.text, backgroundColor: colors.inputBg, marginBottom: 8 }}
                  placeholder="0.00"
                  value={amountTendered}
                  onChangeText={setAmountTendered}
                  keyboardType="decimal-pad"
                  autoFocus
                  placeholderTextColor={colors.textLight}
                />
                {amountTendered ? (
                  <Text style={{ fontSize: 18, fontWeight: '700', color: change >= 0 ? colors.success : colors.danger, textAlign: 'center', marginBottom: 8 }}>
                    {change >= 0 ? `Change: ${fmt(change)}` : `Still needs: ${fmt(Math.abs(change))}`}
                  </Text>
                ) : null}
              </>
            )}

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <TouchableOpacity
                style={{ flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, height: 50, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => setPaymentModal(false)}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, backgroundColor: colors.success, borderRadius: 12, height: 50, alignItems: 'center', justifyContent: 'center' }}
                onPress={processSale}
                disabled={processing || (paymentMethod === 'mpesa' && !mpesaEnabled)}
              >
                {processing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                    {paymentMethod === 'mpesa' ? 'Send STK Push' : 'Confirm Sale'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <LowStockToast message={toast.message} trigger={toast.trigger} />
    </View>
  );
}
