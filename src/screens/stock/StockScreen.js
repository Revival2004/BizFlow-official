import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  Modal, Alert, ActivityIndicator, ScrollView, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fmt } from '../../utils/constants';

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
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    fetchAll();
  }, []);

  const showToast = (message) => {
    setToast({ message, trigger: Date.now() });
  };

  const fetchAll = async () => {
    setLoading(true);

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

      setProducts(productsRes.data || []);
      setCategories(categoriesRes.data || []);
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const filtered = products.filter((product) => {
    const matchesSearch =
      product.name.toLowerCase().includes(search.toLowerCase()) ||
      (product.sku && product.sku.toLowerCase().includes(search.toLowerCase()));

    const matchesCategory = catFilter === 'all' || product.category_id === catFilter;
    return matchesSearch && matchesCategory;
  });

  const resetProductModal = () => {
    setForm(emptyForm);
    setEditProduct(null);
    setModalVisible(false);
  };

  const saveProduct = async () => {
    if (!form.name.trim() || !form.selling_price || !form.cost_price) {
      Alert.alert('Required', 'Name, cost and selling price are required.');
      return;
    }

    setSaving(true);

    const payload = {
      name: form.name.trim(),
      sku: form.sku || null,
      cost_price: parseFloat(form.cost_price),
      selling_price: parseFloat(form.selling_price),
      quantity: parseInt(form.quantity, 10) || 0,
      reorder_level: parseInt(form.reorder_level, 10) || 5,
      category_id: form.category_id || null,
      unit: form.unit || 'pcs',
      description: form.description || null,
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
          showToast(`Low stock: ${form.name} (${newQty} ${form.unit} left)`);
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
      setSaving(false);
    }
  };

  const doAdjustment = async () => {
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
        showToast(`Low stock: ${adjProduct.name} (${newQty} ${adjProduct.unit} left)`);
      } else if (newQty === 0) {
        showToast(`Out of stock: ${adjProduct.name}`);
      }
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const saveCategory = async () => {
    if (!categoryName.trim()) {
      Alert.alert('Error', 'Enter a category name.');
      return;
    }

    setCategorySaving(true);

    try {
      if (editingCategory) {
        const { error } = await supabase
          .from('categories')
          .update({ name: categoryName.trim() })
          .eq('id', editingCategory.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('categories')
          .insert({
            business_id: profile.business_id,
            name: categoryName.trim(),
          });

        if (error) throw error;
      }

      setCategoryName('');
      setEditingCategory(null);
      await fetchAll();
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setCategorySaving(false);
    }
  };

  const removeCategory = (category) => {
    Alert.alert('Delete Category', `Delete "${category.name}"?`, [
      { text: 'Cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
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
          }
        },
      },
    ]);
  };

  const totalStockValue = products.reduce((sum, product) => sum + (product.cost_price * product.quantity), 0);
  const lowStockCount = products.filter((product) => product.quantity > 0 && product.quantity <= product.reorder_level).length;
  const outCount = products.filter((product) => product.quantity === 0).length;

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: insets.bottom }}>
      <View style={{ flexDirection: 'row', padding: 12, gap: 10 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 12, height: 42, borderWidth: 1, borderColor: colors.border }}>
          <Ionicons name="search" size={16} color={colors.textLight} />
          <TextInput style={{ flex: 1, marginLeft: 8, fontSize: 14, color: colors.text }} placeholder="Search products, SKU..." value={search} onChangeText={setSearch} placeholderTextColor={colors.textLight} />
        </View>
        {hasPermission('manage_categories') && (
          <TouchableOpacity style={{ width: 42, height: 42, backgroundColor: colors.warning, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }} onPress={() => setCategoryModal(true)}>
            <Ionicons name="grid" size={20} color="#fff" />
          </TouchableOpacity>
        )}
        {hasPermission('add_stock') && (
          <TouchableOpacity style={{ width: 42, height: 42, backgroundColor: colors.secondary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }} onPress={() => { setForm(emptyForm); setEditProduct(null); setModalVisible(true); }}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 12, marginBottom: 8 }}>
        {['all', ...categories.map((category) => category.id)].map((id) => {
          const category = id === 'all' ? { name: 'All' } : categories.find((entry) => entry.id === id);
          return (
            <TouchableOpacity key={id} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: catFilter === id ? colors.secondary : colors.card, borderWidth: 1, borderColor: catFilter === id ? colors.secondary : colors.border, marginRight: 8 }} onPress={() => setCatFilter(id)}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: catFilter === id ? '#fff' : colors.textLight }}>{category?.name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={{ flexDirection: 'row', backgroundColor: colors.card, marginHorizontal: 12, borderRadius: 12, padding: 12, marginBottom: 10 }}>
        {[
          { label: 'Products', value: products.length, color: colors.text },
          { label: 'Low Stock', value: lowStockCount, color: colors.warning },
          { label: 'Out of Stock', value: outCount, color: colors.danger },
          { label: 'Stock Value', value: `KSh ${(totalStockValue / 1000).toFixed(1)}K`, color: colors.secondary },
        ].map((item, index) => (
          <View key={index} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: item.color }}>{item.value}</Text>
            <Text style={{ fontSize: 9, color: colors.textLight, marginTop: 2, textAlign: 'center' }}>{item.label}</Text>
          </View>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 12, paddingTop: 0, paddingBottom: 16 }}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 8, flexDirection: 'row', borderLeftWidth: 4, borderLeftColor: item.quantity === 0 ? colors.danger : item.quantity <= item.reorder_level ? colors.warning : colors.border }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 }}>{item.name}</Text>
                {item.quantity === 0 && <View style={{ backgroundColor: colors.danger + '20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ color: colors.danger, fontSize: 9, fontWeight: '700' }}>OUT</Text></View>}
                {item.quantity > 0 && item.quantity <= item.reorder_level && <View style={{ backgroundColor: colors.warning + '20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ color: colors.warning, fontSize: 9, fontWeight: '700' }}>LOW</Text></View>}
              </View>
              {item.sku ? <Text style={{ fontSize: 11, color: colors.textLight }}>SKU: {item.sku}</Text> : null}
              <Text style={{ fontSize: 11, color: colors.secondary, fontWeight: '600' }}>{item.categories?.name || 'Uncategorised'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text }}>{fmt(item.selling_price)}</Text>
                <Text style={{ fontSize: 11, color: colors.textLight }}>Cost: {fmt(item.cost_price)}</Text>
                {item.selling_price > 0 && <Text style={{ fontSize: 11, color: colors.success, fontWeight: '600' }}>{(((item.selling_price - item.cost_price) / item.selling_price) * 100).toFixed(0)}% margin</Text>}
              </View>
            </View>
            <View style={{ alignItems: 'center', justifyContent: 'center', minWidth: 64 }}>
              <Text style={{ fontSize: 28, fontWeight: '900', color: item.quantity === 0 ? colors.danger : colors.text }}>{item.quantity}</Text>
              <Text style={{ fontSize: 10, color: colors.textLight }}>{item.unit}</Text>
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 6 }}>
                {hasPermission('add_stock') && (
                  <TouchableOpacity style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }} onPress={() => { setAdjProduct(item); setAdjQty(''); setAdjNote(''); setAdjType('add'); setAdjModal(true); }}>
                    <Ionicons name="layers" size={16} color={colors.secondary} />
                  </TouchableOpacity>
                )}
                {hasPermission('edit_stock') && (
                  <TouchableOpacity style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }} onPress={() => { setForm({ name: item.name, sku: item.sku || '', cost_price: String(item.cost_price), selling_price: String(item.selling_price), quantity: String(item.quantity), reorder_level: String(item.reorder_level || 5), category_id: item.category_id || '', unit: item.unit || 'pcs', description: item.description || '' }); setEditProduct(item); setModalVisible(true); }}>
                    <Ionicons name="pencil" size={16} color={colors.warning} />
                  </TouchableOpacity>
                )}
                {hasPermission('delete_stock') && (
                  <TouchableOpacity style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }} onPress={() => Alert.alert('Delete', `Delete "${item.name}"?`, [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => {
                    try {
                      const { error } = await supabase.from('products').update({ is_active: false }).eq('id', item.id);
                      if (error) throw error;
                      await fetchAll();
                    } catch (err) {
                      Alert.alert('Error', err.message);
                    }
                  } }])}>
                    <Ionicons name="trash" size={16} color={colors.danger} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={<View style={{ alignItems: 'center', padding: 48 }}><Ionicons name="cube-outline" size={48} color={colors.textLight} /><Text style={{ color: colors.textLight, marginTop: 10 }}>No products found</Text></View>}
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
                    <Text style={{ fontSize: 12, fontWeight: '600', color: form.category_id === category.id ? '#fff' : colors.textLight }}>{category.name}</Text>
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
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{adjProduct?.name}</Text>
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
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{category.name}</Text>
                  </View>
                  <TouchableOpacity style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', marginRight: 8 }} onPress={() => { setEditingCategory(category); setCategoryName(category.name); }}>
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
