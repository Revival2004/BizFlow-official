import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  Modal, Alert, ActivityIndicator, ScrollView, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fmt } from '../../utils/constants';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { cleanObject, cleanText } from '../../utils/textEncoding';
import { cacheProducts, cacheStockSnapshot, getCachedStockSnapshot } from '../../utils/offline';

function LowStockToast({ message, trigger }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!trigger || !message) {
      return;
    }

    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(2800),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [message, opacity, trigger]);

  return (
    <Animated.View style={{ opacity, position: 'absolute', bottom: 24, left: 16, right: 16, backgroundColor: '#F59F00', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 999, elevation: 10 }}>
      <Ionicons name="warning" size={18} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13, flex: 1 }}>{message}</Text>
    </Animated.View>
  );
}

const emptyForm = {
  name: '',
  sku: '',
  cost_price: '',
  selling_price: '',
  quantity: '',
  reorder_level: '5',
  category_id: '',
  unit: 'pcs',
  description: '',
};

export default function StockScreen() {
  const { profile, hasPermission } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const fetchRequestRef = useRef(0);
  const productActionRef = useRef(false);
  const adjustmentActionRef = useRef(false);
  const categoryActionRef = useRef(false);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [adjModal, setAdjModal] = useState(false);
  const [adjProduct, setAdjProduct] = useState(null);
  const [adjQty, setAdjQty] = useState('');
  const [adjType, setAdjType] = useState('add');
  const [adjNote, setAdjNote] = useState('');
  const [toast, setToast] = useState({ message: '', trigger: 0 });
  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState(null);
  const [categorySaving, setCategorySaving] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    fetchAll();
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!state.isConnected);
    });

    NetInfo.fetch().then((state) => {
      setIsOffline(!state.isConnected);
    });

    return () => unsubscribe();
  }, [profile?.business_id]);

  const showToast = (message) => {
    setToast({ message, trigger: Date.now() });
  };

  const fetchAll = async ({ silent = false } = {}) => {
    if (!profile?.business_id) {
      setProducts([]);
      setCategories([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!silent) {
      setLoading(true);
    }

    const requestId = Date.now();
    fetchRequestRef.current = requestId;

    try {
      const [productsRes, categoriesRes] = await Promise.all([
        supabase
          .from('products')
          .select('*, categories(name)')
          .eq('business_id', profile.business_id)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('categories')
          .select('*')
          .eq('business_id', profile.business_id)
          .order('name'),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (categoriesRes.error) throw categoriesRes.error;

      if (fetchRequestRef.current !== requestId) {
        return;
      }

      const cleanedProducts = cleanObject(productsRes.data || []);
      const cleanedCategories = cleanObject(categoriesRes.data || []);

      setProducts(cleanedProducts);
      setCategories(cleanedCategories);
      await cacheProducts(cleanedProducts);
      await cacheStockSnapshot(profile.business_id, {
        products: cleanedProducts,
        categories: cleanedCategories,
      });
    } catch (error) {
      if (fetchRequestRef.current === requestId) {
        const cached = await getCachedStockSnapshot(profile?.business_id);
        if (cached) {
          setProducts(cleanObject(cached.products || []));
          setCategories(cleanObject(cached.categories || []));
        } else {
          Alert.alert('Error', error.message);
        }
      }
    } finally {
      if (fetchRequestRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const refreshAll = async () => {
    setRefreshing(true);
    await fetchAll({ silent: true });
  };

  useRealtimeRefresh({
    enabled: Boolean(profile?.business_id) && !isOffline,
    channelName: `stock:${profile?.business_id}`,
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
        table: 'categories',
        filter: `business_id=eq.${profile?.business_id}`,
      },
      {
        event: '*',
        schema: 'public',
        table: 'stock_movements',
        filter: `business_id=eq.${profile?.business_id}`,
      },
    ],
    onChange: fetchAll,
  });

  const searchTerm = cleanText(search || '').toLowerCase();
  const filtered = products.filter((product) => {
    const matchesSearch =
      cleanText(product.name || '').toLowerCase().includes(searchTerm) ||
      cleanText(product.sku || '').toLowerCase().includes(searchTerm);

    const matchesCategory = catFilter === 'all' || product.category_id === catFilter;
    return matchesSearch && matchesCategory;
  });

  const resetProductModal = () => {
    setForm(emptyForm);
    setEditProduct(null);
    setModalVisible(false);
  };

  const saveProduct = async () => {
    if (saving || productActionRef.current) {
      return;
    }

    if (isOffline) {
      Alert.alert('Internet Required', 'Product edits need a connection so BizFlow can keep inventory safe across devices.');
      return;
    }

    if (!form.name.trim() || !form.selling_price || !form.cost_price) {
      Alert.alert('Required', 'Name, cost and selling price are required.');
      return;
    }

    productActionRef.current = true;
    setSaving(true);

    const payload = {
      name: cleanText(form.name.trim()),
      sku: cleanText(form.sku || '') || null,
      cost_price: parseFloat(form.cost_price),
      selling_price: parseFloat(form.selling_price),
      quantity: parseInt(form.quantity, 10) || 0,
      reorder_level: parseInt(form.reorder_level, 10) || 5,
      category_id: form.category_id || null,
      unit: cleanText(form.unit || 'pcs'),
      description: cleanText(form.description || '') || null,
      business_id: profile.business_id,
      is_active: true,
    };

    try {
      if (editProduct) {
        const { error: updateError } = await supabase
          .from('products')
          .update(payload)
          .eq('id', editProduct.id);

        if (updateError) throw updateError;

        const newQty = parseInt(form.quantity, 10) || 0;
        if (newQty !== editProduct.quantity) {
          const { error: movementError } = await supabase
            .from('stock_movements')
            .insert({
              product_id: editProduct.id,
              business_id: profile.business_id,
              type: 'adjustment',
              quantity: newQty - editProduct.quantity,
              reference: 'EDIT',
              performed_by: profile.id,
              notes: 'Manual edit',
            });

          if (movementError) throw movementError;
        }

        if (newQty <= (parseInt(form.reorder_level, 10) || 5) && newQty > 0) {
          showToast(`Low stock: ${cleanText(form.name || '')} (${newQty} ${form.unit} left)`);
        }
      } else {
        const { data, error } = await supabase
          .from('products')
          .insert(payload)
          .select()
          .single();

        if (error) throw error;

        if ((parseInt(form.quantity, 10) || 0) > 0) {
          const { error: movementError } = await supabase
            .from('stock_movements')
            .insert({
              product_id: data.id,
              business_id: profile.business_id,
              type: 'initial',
              quantity: parseInt(form.quantity, 10),
              reference: 'INIT',
              performed_by: profile.id,
              notes: 'Initial stock',
            });

          if (movementError) throw movementError;
        }
      }

      resetProductModal();
      await fetchAll();
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      productActionRef.current = false;
      setSaving(false);
    }
  };

  const doAdjustment = async () => {
    if (saving || adjustmentActionRef.current) {
      return;
    }

    if (isOffline) {
      Alert.alert('Internet Required', 'Stock adjustments need a connection so BizFlow can avoid inventory conflicts.');
      return;
    }

    const qty = parseInt(adjQty, 10);
    if (!qty || qty <= 0) {
      Alert.alert('Error', 'Enter a valid quantity.');
      return;
    }

    const delta = adjType === 'add' ? qty : -qty;
    const newQty = adjProduct.quantity + delta;

    if (newQty < 0) {
      Alert.alert('Error', 'Cannot go below zero stock.');
      return;
    }

    adjustmentActionRef.current = true;
    setSaving(true);

    try {
      const { error: productError } = await supabase
        .from('products')
        .update({ quantity: newQty })
        .eq('id', adjProduct.id);

      if (productError) throw productError;

      const { error: movementError } = await supabase
        .from('stock_movements')
        .insert({
          product_id: adjProduct.id,
          business_id: profile.business_id,
          type: adjType === 'add' ? 'restock' : 'adjustment',
          quantity: delta,
          reference: `ADJ-${Date.now().toString().slice(-6)}`,
          performed_by: profile.id,
          notes: adjNote || `Manual ${adjType}`,
        });

      if (movementError) throw movementError;

      setAdjModal(false);
      setAdjProduct(null);
      setAdjQty('');
      setAdjNote('');
      await fetchAll();

      if (newQty <= adjProduct.reorder_level && newQty > 0) {
        showToast(`Low stock: ${cleanText(adjProduct.name || '')} (${newQty} ${adjProduct.unit} left)`);
      } else if (newQty === 0) {
        showToast(`Out of stock: ${cleanText(adjProduct.name || '')}`);
      }
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      adjustmentActionRef.current = false;
      setSaving(false);
    }
  };

  const saveCategory = async () => {
    if (categorySaving || categoryActionRef.current) {
      return;
    }

    if (isOffline) {
      Alert.alert('Internet Required', 'Category changes need a connection before BizFlow can save them.');
      return;
    }

    if (!categoryName.trim()) {
      Alert.alert('Error', 'Enter a category name.');
      return;
    }

    categoryActionRef.current = true;
    setCategorySaving(true);

    try {
      const cleanedCategoryName = cleanText(categoryName.trim());

      if (editingCategory) {
        const { error } = await supabase
          .from('categories')
          .update({ name: cleanedCategoryName })
          .eq('id', editingCategory.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('categories')
          .insert({
            business_id: profile.business_id,
            name: cleanedCategoryName,
          });

        if (error) throw error;
      }

      setCategoryName('');
      setEditingCategory(null);
      await fetchAll();
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      categoryActionRef.current = false;
      setCategorySaving(false);
    }
  };

  const removeCategory = (category) => {
    Alert.alert('Delete Category', `Delete "${cleanText(category.name || '')}"?`, [
      { text: 'Cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (categoryActionRef.current) {
            return;
          }

          if (isOffline) {
            Alert.alert('Internet Required', 'Reconnect before deleting categories.');
            return;
          }

          categoryActionRef.current = true;

          try {
            const { count, error: usageError } = await supabase
              .from('products')
              .select('id', { count: 'exact', head: true })
              .eq('business_id', profile.business_id)
              .eq('category_id', category.id)
              .eq('is_active', true);

            if (usageError) throw usageError;
            if ((count || 0) > 0) {
              Alert.alert('Category In Use', 'Move products out of this category before deleting it.');
              return;
            }

            const { error } = await supabase
              .from('categories')
              .delete()
              .eq('id', category.id);

            if (error) throw error;

            if (catFilter === category.id) {
              setCatFilter('all');
            }

            await fetchAll();
          } catch (err) {
            Alert.alert('Error', err.message);
          } finally {
            categoryActionRef.current = false;
          }
        },
      },
    ]);
  };

  const totalStockValue = products.reduce((sum, product) => sum + (product.cost_price * product.quantity), 0);
  const lowStockProducts = products.filter((product) => product.quantity > 0 && product.quantity <= product.reorder_level);
  const lowStockCount = lowStockProducts.length;
  const outCount = products.filter((product) => product.quantity === 0).length;
  const healthyCount = Math.max(products.length - lowStockCount - outCount, 0);
  const stockHealth = products.length ? Math.round((healthyCount / products.length) * 100) : 100;
  const categoryOptions = [{ id: 'all', name: 'All Items' }, ...categories.map((category) => ({ id: category.id, name: category.name }))];

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {isOffline && (
        <View style={{ backgroundColor: '#F59F00', padding: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <Ionicons name="cloud-offline" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Offline mode: showing your last synced stock. Editing is paused until you reconnect.</Text>
        </View>
      )}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshing={refreshing}
        onRefresh={refreshAll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 12, paddingBottom: 20 + insets.bottom }}
        ListHeaderComponent={(
          <>
            <View style={{ backgroundColor: colors.card, borderRadius: 22, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: colors.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ fontSize: 21, fontWeight: '800', color: colors.text }}>Stock Center</Text>
                  <Text style={{ fontSize: 13, color: colors.textLight, marginTop: 4 }}>
                    Track inventory, low-stock pressure, and category performance at a glance.
                  </Text>
                </View>
                <View style={{ backgroundColor: colors.secondary + '12', borderRadius: 16, width: 54, height: 54, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="cube" size={26} color={colors.secondary} />
                </View>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {[
                  { label: 'Products', value: products.length, hint: `${healthyCount} healthy`, color: colors.text, icon: 'layers-outline' },
                  { label: 'Low Stock', value: lowStockCount, hint: lowStockCount > 0 ? 'Needs restock' : 'All good', color: colors.warning, icon: 'warning-outline' },
                  { label: 'Out of Stock', value: outCount, hint: outCount > 0 ? 'Urgent action' : 'No outages', color: colors.danger, icon: 'remove-circle-outline' },
                  { label: 'Stock Value', value: fmt(totalStockValue), hint: `${stockHealth}% healthy`, color: colors.secondary, icon: 'cash-outline' },
                ].map((card) => (
                  <View key={card.label} style={{ width: '48%', backgroundColor: colors.bg, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Ionicons name={card.icon} size={16} color={card.color} />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textLight }}>{card.label}</Text>
                    </View>
                    <Text style={{ fontSize: 18, fontWeight: '900', color: card.color }}>{card.value}</Text>
                    <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 4 }}>{card.hint}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 14, height: 48, borderWidth: 1, borderColor: colors.border }}>
                <Ionicons name="search" size={17} color={colors.textLight} />
                <TextInput
                  style={{ flex: 1, marginLeft: 10, fontSize: 14, color: colors.text }}
                  placeholder="Search products or SKU"
                  value={search}
                  onChangeText={setSearch}
                  placeholderTextColor={colors.textLight}
                />
              </View>
              {hasPermission('manage_categories') && (
                <TouchableOpacity
                  style={{ width: 48, height: 48, backgroundColor: colors.warning, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => setCategoryModal(true)}
                >
                  <Ionicons name="grid" size={20} color="#fff" />
                </TouchableOpacity>
              )}
              {hasPermission('add_stock') && (
                <TouchableOpacity
                  style={{ width: 48, height: 48, backgroundColor: colors.secondary, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => { setForm(emptyForm); setEditProduct(null); setModalVisible(true); }}
                >
                  <Ionicons name="add" size={22} color="#fff" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {categoryOptions.map((category) => (
                <TouchableOpacity
                  key={category.id}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: catFilter === category.id ? colors.secondary : colors.card,
                    borderWidth: 1,
                    borderColor: catFilter === category.id ? colors.secondary : colors.border,
                    marginRight: 8,
                  }}
                  onPress={() => setCatFilter(category.id)}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: catFilter === category.id ? '#fff' : colors.textLight }}>
                    {cleanText(category.name || '')}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>
                {filtered.length} of {products.length} item{products.length === 1 ? '' : 's'}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textLight }}>
                {lowStockCount > 0 ? `${lowStockCount} low stock` : 'Inventory stable'}
              </Text>
            </View>
          </>
        )}
        renderItem={({ item }) => {
          const isOut = item.quantity === 0;
          const isLow = item.quantity > 0 && item.quantity <= item.reorder_level;
          const margin = item.selling_price > 0
            ? (((item.selling_price - item.cost_price) / item.selling_price) * 100).toFixed(0)
            : '0';

          return (
            <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: colors.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: (isOut ? colors.danger : isLow ? colors.warning : colors.secondary) + '14', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Ionicons name={isOut ? 'alert-circle' : isLow ? 'warning' : 'cube-outline'} size={22} color={isOut ? colors.danger : isLow ? colors.warning : colors.secondary} />
                </View>

                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                    <Text style={{ flex: 1, fontSize: 16, fontWeight: '800', color: colors.text }}>{cleanText(item.name || '')}</Text>
                    <View style={{ backgroundColor: (isOut ? colors.danger : isLow ? colors.warning : colors.success) + '16', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: isOut ? colors.danger : isLow ? colors.warning : colors.success }}>
                        {isOut ? 'OUT' : isLow ? 'LOW' : 'OK'}
                      </Text>
                    </View>
                  </View>

                  <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 4 }}>
                    {item.sku ? `SKU ${cleanText(item.sku || '')} · ` : ''}{cleanText(item.categories?.name || 'Uncategorised')}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 16, padding: 12, marginTop: 14 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.textLight, marginBottom: 4 }}>Selling Price</Text>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: colors.secondary }}>{fmt(item.selling_price)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.textLight, marginBottom: 4 }}>Cost</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{fmt(item.cost_price)}</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 11, color: colors.textLight, marginBottom: 4 }}>In Stock</Text>
                  <Text style={{ fontSize: 22, fontWeight: '900', color: isOut ? colors.danger : colors.text }}>{item.quantity}</Text>
                  <Text style={{ fontSize: 11, color: colors.textLight }}>{cleanText(item.unit || 'pcs')}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 2 }}>
                <Text style={{ fontSize: 12, color: colors.textLight }}>Reorder at {item.reorder_level}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.success }}>{margin}% margin</Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                {hasPermission('add_stock') && (
                  <TouchableOpacity
                    style={{ flex: 1, height: 42, borderRadius: 12, backgroundColor: colors.secondary + '12', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
                    onPress={() => { setAdjProduct(item); setAdjQty(''); setAdjNote(''); setAdjType('add'); setAdjModal(true); }}
                  >
                    <Ionicons name="layers" size={16} color={colors.secondary} />
                    <Text style={{ color: colors.secondary, fontWeight: '700', fontSize: 12 }}>Adjust</Text>
                  </TouchableOpacity>
                )}
                {hasPermission('edit_stock') && (
                  <TouchableOpacity
                    style={{ flex: 1, height: 42, borderRadius: 12, backgroundColor: colors.warning + '14', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
                    onPress={() => {
                      setForm({
                        name: cleanText(item.name || ''),
                        sku: cleanText(item.sku || ''),
                        cost_price: String(item.cost_price),
                        selling_price: String(item.selling_price),
                        quantity: String(item.quantity),
                        reorder_level: String(item.reorder_level || 5),
                        category_id: item.category_id || '',
                        unit: cleanText(item.unit || 'pcs'),
                        description: cleanText(item.description || ''),
                      });
                      setEditProduct(item);
                      setModalVisible(true);
                    }}
                  >
                    <Ionicons name="pencil" size={16} color={colors.warning} />
                    <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 12 }}>Edit</Text>
                  </TouchableOpacity>
                )}
                {hasPermission('delete_stock') && (
                  <TouchableOpacity
                    style={{ width: 48, height: 42, borderRadius: 12, backgroundColor: colors.danger + '14', alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => Alert.alert('Delete', `Delete "${cleanText(item.name || '')}"?`, [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => {
                      if (productActionRef.current) {
                        return;
                      }

                      productActionRef.current = true;

                      try {
                        const { error } = await supabase.from('products').update({ is_active: false }).eq('id', item.id);
                        if (error) throw error;
                        await fetchAll();
                      } catch (err) {
                        Alert.alert('Error', err.message);
                      } finally {
                        productActionRef.current = false;
                      }
                    } }])}
                  >
                    <Ionicons name="trash" size={16} color={colors.danger} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={(
          <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 36, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}>
            <Ionicons name="cube-outline" size={50} color={colors.textLight} />
            <Text style={{ color: colors.text, marginTop: 12, fontSize: 16, fontWeight: '700' }}>No products found</Text>
            <Text style={{ color: colors.textLight, marginTop: 6, textAlign: 'center' }}>
              Try another search term or switch your category filter.
            </Text>
          </View>
        )}
      />

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '88%', paddingBottom: 24 + insets.bottom }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{editProduct ? 'Edit Product' : 'Add Product'}</Text>
              <TouchableOpacity onPress={resetProductModal}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {[
                { label: 'Product Name *', key: 'name', placeholder: 'e.g. Coca Cola 500ml' },
                { label: 'SKU / Barcode', key: 'sku', placeholder: 'Optional' },
                { label: 'Cost Price (KES) *', key: 'cost_price', placeholder: '0.00', numeric: true },
                { label: 'Selling Price (KES) *', key: 'selling_price', placeholder: '0.00', numeric: true },
                { label: 'Quantity', key: 'quantity', placeholder: '0', numeric: true },
                { label: 'Reorder Level (alert below this)', key: 'reorder_level', placeholder: '5', numeric: true },
                { label: 'Unit (pcs / kg / L / box)', key: 'unit', placeholder: 'pcs' },
              ].map((field) => (
                <View key={field.key} style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text, marginBottom: 5 }}>{field.label}</Text>
                  <TextInput style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, height: 46, fontSize: 14, color: colors.text, backgroundColor: colors.inputBg }} placeholder={field.placeholder} value={form[field.key]} onChangeText={(value) => setForm({ ...form, [field.key]: value })} keyboardType={field.numeric ? 'decimal-pad' : 'default'} placeholderTextColor={colors.textLight} />
                </View>
              ))}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text }}>Category</Text>
                {hasPermission('manage_categories') && (
                  <TouchableOpacity onPress={() => setCategoryModal(true)}>
                    <Text style={{ color: colors.secondary, fontSize: 12, fontWeight: '700' }}>Manage</Text>
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <TouchableOpacity style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: form.category_id === '' ? colors.secondary : colors.bg, borderWidth: 1, borderColor: form.category_id === '' ? colors.secondary : colors.border, marginRight: 8 }} onPress={() => setForm({ ...form, category_id: '' })}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: form.category_id === '' ? '#fff' : colors.textLight }}>Uncategorised</Text>
                </TouchableOpacity>
                {categories.map((category) => (
                  <TouchableOpacity key={category.id} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: form.category_id === category.id ? colors.secondary : colors.bg, borderWidth: 1, borderColor: form.category_id === category.id ? colors.secondary : colors.border, marginRight: 8 }} onPress={() => setForm({ ...form, category_id: category.id })}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: form.category_id === category.id ? '#fff' : colors.textLight }}>{cleanText(category.name || '')}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity style={{ backgroundColor: colors.secondary, borderRadius: 12, height: 50, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }} onPress={saveProduct} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{editProduct ? 'Update Product' : 'Add Product'}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={adjModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 24 + insets.bottom }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>Adjust Stock</Text>
              <TouchableOpacity onPress={() => setAdjModal(false)}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{cleanText(adjProduct?.name || '')}</Text>
            <Text style={{ fontSize: 13, color: colors.textLight, marginBottom: 14 }}>Current: {adjProduct?.quantity} {adjProduct?.unit}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              {['add', 'remove'].map((type) => (
                <TouchableOpacity key={type} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: adjType === type ? (type === 'add' ? colors.success : colors.danger) : colors.border, borderRadius: 10, paddingVertical: 10, backgroundColor: adjType === type ? (type === 'add' ? colors.success : colors.danger) : 'transparent' }} onPress={() => setAdjType(type)}>
                  <Ionicons name={type === 'add' ? 'add-circle' : 'remove-circle'} size={18} color={adjType === type ? '#fff' : colors.textLight} />
                  <Text style={{ fontWeight: '600', color: adjType === type ? '#fff' : colors.textLight, textTransform: 'capitalize' }}>{type === 'add' ? 'Add Stock' : 'Remove'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, height: 50, fontSize: 18, fontWeight: '700', color: colors.text, backgroundColor: colors.inputBg, marginBottom: 10 }} placeholder="Quantity" value={adjQty} onChangeText={setAdjQty} keyboardType="number-pad" autoFocus placeholderTextColor={colors.textLight} />
            <TextInput style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, height: 44, fontSize: 14, color: colors.text, backgroundColor: colors.inputBg, marginBottom: 14 }} placeholder="Reason (optional)" value={adjNote} onChangeText={setAdjNote} placeholderTextColor={colors.textLight} />
            <TouchableOpacity style={{ backgroundColor: colors.secondary, borderRadius: 12, height: 50, alignItems: 'center', justifyContent: 'center' }} onPress={doAdjustment} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Apply</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={categoryModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '75%', paddingBottom: 24 + insets.bottom }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>Manage Categories</Text>
              <TouchableOpacity onPress={() => { setCategoryModal(false); setCategoryName(''); setEditingCategory(null); }}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <TextInput style={{ flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 14, color: colors.text, backgroundColor: colors.inputBg }} placeholder="Category name" value={categoryName} onChangeText={setCategoryName} placeholderTextColor={colors.textLight} />
              <TouchableOpacity style={{ backgroundColor: colors.secondary, borderRadius: 12, width: 92, alignItems: 'center', justifyContent: 'center' }} onPress={saveCategory} disabled={categorySaving}>
                {categorySaving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{editingCategory ? 'Update' : 'Add'}</Text>}
              </TouchableOpacity>
            </View>

            <ScrollView>
              {categories.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                  <Ionicons name="grid-outline" size={40} color={colors.textLight} />
                  <Text style={{ color: colors.textLight, marginTop: 8 }}>No categories yet</Text>
                </View>
              ) : categories.map((category) => (
                <View key={category.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{cleanText(category.name || '')}</Text>
                  </View>
                  <TouchableOpacity style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', marginRight: 8 }} onPress={() => { setEditingCategory(category); setCategoryName(cleanText(category.name || '')); }}>
                    <Ionicons name="pencil" size={16} color={colors.warning} />
                  </TouchableOpacity>
                  <TouchableOpacity style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }} onPress={() => removeCategory(category)}>
                    <Ionicons name="trash" size={16} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <LowStockToast message={toast.message} trigger={toast.trigger} />
    </View>
  );
}
