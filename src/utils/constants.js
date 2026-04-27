export const COLORS = {
  primary: '#1A1F36',
  secondary: '#2563EB',
  accent: '#00D2A0',
  danger: '#EF4444',
  warning: '#F59F00',
  success: '#22C55E',
  bg: '#F1F5F9',
  card: '#FFFFFF',
  text: '#0F172A',
  textLight: '#64748B',
  border: '#E2E8F0',
  white: '#FFFFFF',
};

export const CURRENCY = 'KES';
export const CURRENCY_SYMBOL = 'KSh';

export const fmt = (n) => `KSh ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const ROLES = {
  ADMIN: 'admin',
  SALES_MANAGER: 'sales_manager',
  CASHIER: 'cashier',
  STOCK_MANAGER: 'stock_manager',
  ACCOUNTANT: 'accountant',
};

export const ROLE_PERMISSIONS = {
  admin: {
    view_dashboard: true, view_sales: true, create_sale: true, void_sale: true,
    view_stock: true, add_stock: true, edit_stock: true, delete_stock: true,
    view_reports: true, export_reports: true, manage_staff: true, invite_staff: true,
    view_profits: true, manage_categories: true, manage_payments: true,
  },
  sales_manager: {
    view_dashboard: true, view_sales: true, create_sale: true, void_sale: true,
    view_stock: true, add_stock: false, edit_stock: false, delete_stock: false,
    view_reports: true, export_reports: true, manage_staff: false, invite_staff: false,
    view_profits: true, manage_categories: false, manage_payments: false,
  },
  cashier: {
    view_dashboard: true, view_sales: true, create_sale: true, void_sale: false,
    view_stock: true, add_stock: false, edit_stock: false, delete_stock: false,
    view_reports: false, export_reports: false, manage_staff: false, invite_staff: false,
    view_profits: false, manage_categories: false, manage_payments: false,
  },
  stock_manager: {
    view_dashboard: true, view_sales: false, create_sale: false, void_sale: false,
    view_stock: true, add_stock: true, edit_stock: true, delete_stock: true,
    view_reports: true, export_reports: false, manage_staff: false, invite_staff: false,
    view_profits: false, manage_categories: true, manage_payments: false,
  },
  accountant: {
    view_dashboard: true, view_sales: true, create_sale: false, void_sale: false,
    view_stock: true, add_stock: false, edit_stock: false, delete_stock: false,
    view_reports: true, export_reports: true, manage_staff: false, invite_staff: false,
    view_profits: true, manage_categories: false, manage_payments: false,
  },
};
