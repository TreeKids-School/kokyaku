import React, { useState, useEffect, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import { 
  User, Search, PlusCircle, Save, Heart, Activity, 
  Sparkles, Users, Target, StickyNote, Smartphone,
  School, Calendar, Trash2, X, ChevronRight, Loader2,
  Tag, ArrowUpAZ, ArrowDownAZ, CheckSquare, Square, Check, AlertCircle,
  Archive, ArchiveRestore, Trash2 as Trash, Menu
} from 'lucide-react';
import { 
  collection, doc, setDoc, updateDoc, deleteDoc, deleteField,
  onSnapshot, query, orderBy, serverTimestamp, limit 
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { db, auth } from './firebase';
import { signInWithEmailAndPassword, onAuthStateChanged, signInAnonymously } from 'firebase/auth';


const normalizeDate = (str) => {
  if (!str) return '';
  // 全角英数字を半角に変換 (全角文字のみを対象にする)
  let d = str.toString().trim().replace(/[０-９Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  // 区切り文字をハイフンに統一
  d = d.replace(/[\/年.月]/g, '-').replace(/日/g, '');
  
  const eraMap = { 'R': 2018, '令和': 2018, 'H': 1988, '平成': 1988, 'S': 1925, '昭和': 1925, 'T': 1911, '大正': 1911 };
  
  // パターン1: 元号が先頭 (H28-7-15, 令和元-5-1)
  let m = d.match(/^(R|令和|H|平成|S|昭和|T|大正)(元|\d{1,2})-(\d{1,2})-(\d{1,2})$/i);
  if (m) {
    let year = m[2] === '元' ? 1 : parseInt(m[2], 10);
    const eraKey = m[1].toUpperCase();
    year += eraMap[eraKey] || eraMap[m[1]] || 0;
    return `${year}-${m[3].padStart(2, '0')}-${m[4].padStart(2, '0')}`;
  }

  // パターン2: 元号が最後 (7-15-H28)
  m = d.match(/^(\d{1,2})-(\d{1,2})-(R|令和|H|平成|S|昭和|T|大正)(元|\d{1,2})$/i);
  if (m) {
    let year = m[4] === '元' ? 1 : parseInt(m[4], 10);
    const eraKey = m[3].toUpperCase();
    year += eraMap[eraKey] || eraMap[m[3]] || 0;
    
    // 月と日の判定 (一方が12を超えていればそれが日)
    let v1 = parseInt(m[1], 10);
    let v2 = parseInt(m[2], 10);
    let month, day;
    if (v1 > 12) { day = v1; month = v2; }
    else if (v2 > 12) { month = v1; day = v2; }
    else { month = v1; day = v2; } // どちらも12以下なら M-D とみなす
    
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // パターン3: 西暦 (YYYY-MM-DD)
  const match = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }

  // フォールバック: JS標準のDateでパース
  const parsed = new Date(str.toString().trim());
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return str.toString().trim();
};

const formatDateForDisplay = (str) => {
  if (!str) return '生年月日未定';
  const d = normalizeDate(str);
  if (d && d.includes('-')) {
    return d.replace(/-/g, '/');
  }
  return str;
};

const calculateAgeAndGrade = (birthDateStr) => {
  if (!birthDateStr) return { age: null, grade: null };
  const birthDate = new Date(birthDateStr);
  if (isNaN(birthDate)) return { age: null, grade: null };

  const today = new Date();
  
  // Age
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  // Grade (Japan school year starts April 1st)
  let schoolYearStartYear = today.getFullYear();
  if (today.getMonth() < 3) schoolYearStartYear--;

  let ageAtStart = schoolYearStartYear - birthDate.getFullYear();
  // Haya-umare check: born on or before April 1st
  if (birthDate.getMonth() > 3 || (birthDate.getMonth() === 3 && birthDate.getDate() > 1)) {
    ageAtStart--;
  }

  let grade = "";
  if (ageAtStart < 0) grade = "未誕";
  else if (ageAtStart < 3) grade = "未就学";
  else if (ageAtStart === 3) grade = "年少";
  else if (ageAtStart === 4) grade = "年中";
  else if (ageAtStart === 5) grade = "年長";
  else if (ageAtStart >= 6 && ageAtStart <= 11) grade = `小${ageAtStart - 5}`;
  else if (ageAtStart >= 12 && ageAtStart <= 14) grade = `中${ageAtStart - 11}`;
  else if (ageAtStart >= 15 && ageAtStart <= 17) grade = `高${ageAtStart - 14}`;
  else grade = "一般";

  return { age, grade };
};

// Helper for tailwind class merging
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

function App() {
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  
  // ログ機能用のステート
  const [logs, setLogs] = useState([]);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [formData, setFormData] = useState({});
  const fileInputRef = useRef(null);
  const officeInputRef = useRef(null);

  // Sort & Filter state
  const [sortOrder, setSortOrder] = useState('asc');
  const [activeOfficeFilter, setActiveOfficeFilter] = useState(null);
  const [officeInput, setOfficeInput] = useState('');
  const [showOfficeFilter, setShowOfficeFilter] = useState(false);

  // Bulk select state
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkOfficeModalOpen, setBulkOfficeModalOpen] = useState(false);
  const [bulkOfficeTarget, setBulkOfficeTarget] = useState('');
  const [bulkAction, setBulkAction] = useState('add'); // 'add' | 'remove'

  // Office master state
  const [masterOffices, setMasterOffices] = useState([]);

  // Mobile UI state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  const onTouchStart = (e) => {
    const x = e.targetTouches[0].clientX;
    const y = e.targetTouches[0].clientY;
    setTouchEnd(null);
    setTouchStart({ x, y });
  };

  const onTouchMove = (e) => {
    setTouchEnd({
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY
    });
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distanceX = touchStart.x - touchEnd.x;
    const distanceY = touchStart.y - touchEnd.y;
    const isHorizontalSwipe = Math.abs(distanceX) > Math.abs(distanceY) * 1.5;

    if (isHorizontalSwipe && Math.abs(distanceX) > 50) {
      if (distanceX > 0) {
        setIsSidebarOpen(false); // Right to Left (Close)
      } else if (touchStart.x < 50) {
        // Only open if started from near the left edge
        setIsSidebarOpen(true); 
      }
    }
  };
  
  // CSV Import Preview state
  const [importPreviewData, setImportPreviewData] = useState(null);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importCommonOffices, setImportCommonOffices] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState('skip'); // 'skip' | 'add'
  const [showArchived, setShowArchived] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // ログ書き込み関数
  const writeLog = async (action, details, staffName = null) => {
    try {
      let operator = staffName || formData?.staffInCharge || auth.currentUser?.email || "未設定の担当者";
      if (operator === "admin@kanbanapp.local" || operator === "admin@tree-kids.jp") {
        operator = "管理者";
      } else if (operator.includes("@")) {
        operator = operator.split('@')[0];
      }
      
      const newLogId = `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      await setDoc(doc(db, "logs", newLogId), {
        operator,
        action,
        details,
        timestamp: serverTimestamp()
      });
    } catch (e) {
      console.error("Failed to write log:", e);
    }
  };

  // ログ読み込みの購読
  useEffect(() => {
    if (!isLogModalOpen) return;

    setIsLoadingLogs(true);
    const q = query(
      collection(db, "logs"),
      orderBy("timestamp", "desc"),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setLogs(data);
      setIsLoadingLogs(false);
    }, (err) => {
      console.error("Logs fetch error:", err);
      setIsLoadingLogs(false);
    });

    return () => unsubscribe();
  }, [isLogModalOpen]);

  // 1. Initial Auth & Subscribe to Children data
  useEffect(() => {
    const loginAnonymously = () => {
      signInAnonymously(auth).catch(err3 => {
        console.error("Auth error (anonymous):", err3);
        setIsLoading(false);
        setToast("認証エラー: データベースへのアクセス権限がありませんでした。");
      });
    };

    const attemptLogin = async () => {
      const credentials = [
        { email: "admin@kanbanapp.local", pass: "Tree0001" },
        { email: "ブラック@kanbanapp.local", pass: "Tree0001" },
        { email: "admin@tree-kids.jp", pass: "Tree0001" },
        { email: "ブラック@tree-kids.jp", pass: "Tree0001" },
        { email: "staff-01@tree-kids.jp", pass: "Tree0001" }
      ];

      for (const cred of credentials) {
        try {
          await signInWithEmailAndPassword(auth, cred.email, cred.pass);
          console.log(`Logged in successfully as ${cred.email}`);
          return;
        } catch (err) {
          console.warn(`Failed to login as ${cred.email}:`, err.message);
        }
      }

      console.warn("All email auth attempts failed, trying anonymous auth...");
      loginAnonymously();
    };

    attemptLogin();

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        // 認証後にデータを購読 (orderBy を外して、nameがないドキュメントも取得可能にする)
        const q = query(collection(db, "children"));
        const unsubscribeDb = onSnapshot(q, (snapshot) => {
          const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          
          // データ移行ロジック: lastName がないドキュメントを検出し、name を分割して保存
          data.forEach(async (child) => {
            if (child.name && !child.lastName) {
              const nameParts = child.name.split(/[\s　]+/); // 半角・全角スペースで分割
              const lastName = nameParts[0] || '';
              const firstName = nameParts.slice(1).join(' ') || '';
              try {
                await updateDoc(doc(db, "children", child.id), {
                  lastName,
                  firstName,
                  updatedAt: serverTimestamp()
                });
                console.log(`Migrated child: ${child.name} -> ${lastName} ${firstName}`);
              } catch (e) {
                console.error(`Migration failed for ${child.id}:`, e);
              }
            }
            // 事業所(tags->offices)移行ロジック
            if (child.tags && child.offices === undefined) {
              try {
                await updateDoc(doc(db, "children", child.id), {
                  offices: child.tags,
                  tags: deleteField(),
                  updatedAt: serverTimestamp()
                });
                console.log(`Migrated tags to offices for: ${child.name || child.lastName}`);
              } catch (e) {
                console.error(`Tags migration failed for ${child.id}:`, e);
              }
            }
            // ふりがな移行ロジック: lastNameFurigana がないドキュメントを検出し、nameFurigana を分割して保存
            if (child.nameFurigana && !child.lastNameFurigana) {
              const furiganaParts = child.nameFurigana.split(/[\s　]+/);
              const lastNameFurigana = furiganaParts[0] || '';
              const firstNameFurigana = furiganaParts.slice(1).join(' ') || '';
              try {
                await updateDoc(doc(db, "children", child.id), {
                  lastNameFurigana,
                  firstNameFurigana,
                  updatedAt: serverTimestamp()
                });
                console.log(`Migrated furigana: ${child.nameFurigana} -> ${lastNameFurigana} ${firstNameFurigana}`);
              } catch (e) {
                console.error(`Furigana migration failed for ${child.id}:`, e);
              }
            }
          });

          // Javascriptメモリ上で名前順にソート（nameFuriganaがない場合は姓カナ+名カナとして扱う）
          data.sort((a, b) => {
            const furiganaA = a.nameFurigana || `${a.lastNameFurigana || ''}${a.firstNameFurigana || ''}`;
            const furiganaB = b.nameFurigana || `${b.lastNameFurigana || ''}${b.firstNameFurigana || ''}`;
            if (furiganaA || furiganaB) {
              return (furiganaA || '').localeCompare(furiganaB || '', 'ja');
            }
            const nameA = a.name || `${a.lastName || ''}${a.firstName || ''}`;
            const nameB = b.name || `${b.lastName || ''}${b.firstName || ''}`;
            return nameA.localeCompare(nameB, 'ja');
          });
          
          setChildren(data);
          setIsLoading(false);
        }, (err) => {
          console.error("Firestore error:", err);
          setIsLoading(false);
          // エラー時はデモデータではなく空にする
          setChildren([]);
          setToast("データの読み込みに失敗しました（権限エラー等）。");
        });
        
        return () => unsubscribeDb();
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Subscribe to offices master
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        const unsub = onSnapshot(collection(db, 'offices'), (snap) => {
          const loadedOffices = snap.docs.map(doc => doc.data().name).filter(Boolean);
          setMasterOffices(loadedOffices.sort((a, b) => a.localeCompare(b, 'ja')));
        }, (err) => {
          console.error('offices subscription error:', err);
        });
        return () => unsub();
      }
    });
    return () => unsubAuth();
  }, []);


  // 2. Filter & Sort children
  const allOffices = useMemo(() => {
    const officeSet = new Set();
    children.forEach(c => {
      const arr = Array.isArray(c.offices) ? c.offices : Array.isArray(c.tags) ? c.tags : [];
      arr.forEach(o => officeSet.add(o));
    });
    return [...officeSet].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [children]);

  const filteredChildren = useMemo(() => {
    let list = children.filter(c => {
      // showArchivedがtrueのときはアーカイブ済みのみ表示、falseのときは未アーカイブのみ表示
      if (showArchived ? !c.archived : c.archived) return false;
      const fullName = c.name || `${c.lastName || ''}${c.firstName || ''}`;
      const fullFurigana = c.nameFurigana || `${c.lastNameFurigana || ''}${c.firstNameFurigana || ''}`;
      const nameMatch = fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        fullFurigana.includes(searchQuery);
      const childOffices = Array.isArray(c.offices) ? c.offices : Array.isArray(c.tags) ? c.tags : [];
      const officeMatch = activeOfficeFilter === null || childOffices.includes(activeOfficeFilter);
      return nameMatch && officeMatch;
    });
    list.sort((a, b) => {
      const ka = a.nameFurigana || `${a.lastNameFurigana || ''}${a.firstNameFurigana || ''}` || a.name || `${a.lastName || ''}${a.firstName || ''}`;
      const kb = b.nameFurigana || `${b.lastNameFurigana || ''}${b.firstNameFurigana || ''}` || b.name || `${b.lastName || ''}${b.firstName || ''}`;
      const cmp = ka.localeCompare(kb, 'ja');
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [children, searchQuery, activeOfficeFilter, sortOrder, showArchived]);

  const selectedChild = useMemo(() => {
    return children.find(c => c.id === selectedId);
  }, [children, selectedId]);

  // 3. Update local form data when selected child changes
  const prevSelectedIdRef = useRef(null);
  useEffect(() => {
    if (selectedChild) {
      const isNewSelection = prevSelectedIdRef.current !== selectedId;
      
      if (isNewSelection) {
        setFormData({ ...selectedChild });
        setIsEditing(false); // Reset editing mode ONLY when switching children
        prevSelectedIdRef.current = selectedId;
      } else if (!isEditing) {
        // Update form data if Firestore data changes while NOT editing
        setFormData({ ...selectedChild });
      }
    } else {
      prevSelectedIdRef.current = null;
    }
  }, [selectedChild, selectedId, isEditing]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  // 4. Handlers
  const handleSave = async () => {
    if (!selectedId) return;
    setIsSaving(true);
    try {
      const { id, ...saveData } = formData;
      await updateDoc(doc(db, "children", selectedId), {
        ...saveData,
        updatedAt: serverTimestamp()
      });
      const childName = saveData.lastName ? `${saveData.lastName} ${saveData.firstName}` : saveData.name || '未設定';
      await writeLog("情報更新", `${childName}君の情報（詳細）を更新しました`, saveData.staffInCharge);
      showToast("内容を保存しました");
      setIsEditing(false);
    } catch (error) {
      console.error(error);
      alert(`保存に失敗しました: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateChild = async (e) => {
    e.preventDefault();
    const lastName = e.target.lastName.value.trim();
    const firstName = e.target.firstName.value.trim();
    const lastNameFurigana = e.target.lastNameFurigana.value.trim();
    const firstNameFurigana = e.target.firstNameFurigana.value.trim();
    const school = e.target.school.value.trim();
    if (!lastName) return;

    const newId = `child_${Date.now()}`;
    const newChild = {
      lastName,
      firstName,
      lastNameFurigana,
      firstNameFurigana,
      schoolName: school,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    try {
      await setDoc(doc(db, "children", newId), newChild);
      const operatorName = newChild.staffInCharge || auth.currentUser?.email || "未設定の担当者";
      await writeLog("新規登録", `${newChild.lastName} ${newChild.firstName}君を新規登録しました`, operatorName);
      setIsModalOpen(false);
      setSelectedId(newId);
      showToast("新しく児童を登録しました");
    } catch (error) {
      console.error("handleCreateChild error:", error);
      alert(`登録に失敗しました。ページをリロードしてから再度お試しください。
詳細: ${error.message}`);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleFamilyChange = (index, field, value) => {
    const newList = [...(formData.familyMembers || [])];
    newList[index] = { ...newList[index], [field]: value };
    handleChange('familyMembers', newList);
  };

  const addFamilyMember = () => {
    const newList = [...(formData.familyMembers || []), { name: '', age: '', contact: '', address: '' }];
    handleChange('familyMembers', newList);
  };

  const removeFamilyMember = (index) => {
    const newList = (formData.familyMembers || []).filter((_, i) => i !== index);
    handleChange('familyMembers', newList);
  };

  // --- Office handlers ---
  const addOffice = () => {
    const office = officeInput.trim();
    if (!office) return;
    const current = Array.isArray(formData.offices) ? formData.offices : Array.isArray(formData.tags) ? formData.tags : [];
    if (current.includes(office)) { setOfficeInput(''); return; }
    handleChange('offices', [...current, office]);
    setOfficeInput('');
  };

  const removeOffice = (office) => {
    const current = Array.isArray(formData.offices) ? formData.offices : Array.isArray(formData.tags) ? formData.tags : [];
    handleChange('offices', current.filter(o => o !== office));
  };

  const removeFromImport = (tempId) => {
    setImportPreviewData(prev => prev.filter(d => d.tempId !== tempId));
  };

  // --- Bulk select handlers ---
  const toggleBulkMode = () => {
    setIsBulkMode(m => !m);
    setSelectedIds(new Set());
    setBulkOfficeModalOpen(false);
  };

  const toggleSelectChild = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredChildren.map(c => c.id)));
  };

  const deselectAll = () => setSelectedIds(new Set());

  const applyBulkOffice = async () => {
    if (!bulkOfficeTarget || selectedIds.size === 0) return;
    let ok = 0;
    for (const id of selectedIds) {
      const child = children.find(c => c.id === id);
      if (!child) continue;
      const current = Array.isArray(child.offices) ? child.offices : Array.isArray(child.tags) ? child.tags : [];
      let next;
      if (bulkAction === 'add') {
        next = current.includes(bulkOfficeTarget) ? current : [...current, bulkOfficeTarget];
      } else {
        next = current.filter(o => o !== bulkOfficeTarget);
      }
      try {
        await updateDoc(doc(db, 'children', id), { offices: next, updatedAt: serverTimestamp() });
        ok++;
      } catch (e) {
        console.error('bulk office error:', e);
      }
    }
    showToast(`${ok} 件に事業所を${bulkAction === 'add' ? '追加' : '削除'}しました`);
    setBulkOfficeModalOpen(false);
    setBulkOfficeTarget('');
    setSelectedIds(new Set());
    setIsBulkMode(false);
  };

  // =====================
  // CSV Import (encoding-auto)
  // =====================
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target.result;

      // Detect encoding: if UTF-8 produces replacement chars (�), file is Shift-JIS
      let csvText;
      try {
        const utf8Text = new TextDecoder('utf-8').decode(buffer);
        if (utf8Text.includes('�')) {
          csvText = new TextDecoder('shift-jis').decode(buffer);
        } else {
          csvText = utf8Text;
        }
      } catch {
        csvText = new TextDecoder('utf-8').decode(buffer);
      }

      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rawData = results.data;
          if (rawData.length === 0) {
            alert('データが見つかりませんでした。');
            return;
          }

          const headerKeys = Object.keys(rawData[0] || {});
          // Normalize headers by replacing full-width parentheses with half-width for better matching
          const normalizedHeaders = headerKeys.map(k => k.replace(/（/g, '(').replace(/）/g, ')'));
          const findKey = (patterns, excludePatterns = []) => {
            const index = normalizedHeaders.findIndex(k => 
              patterns.some(p => k.includes(p)) && !excludePatterns.some(ep => k.includes(ep))
            );
            return index !== -1 ? headerKeys[index] : undefined;
          };

          const nameKey      = findKey(['放課後', '氏名', '名前', '児童', '氏名']);
          const furiganaKey  = findKey(['ふりがな', 'フリガナ', 'よみ', 'ヨミ', 'カナ', '読み', '氏名カナ', '児童ふりがな']);
          const schoolKey    = findKey(['学校', '園', '在籍', '小学校', '保育園', '幼稚園']);
          const gradeKey     = findKey(['学年', 'クラス']);
          const birthDateKey = findKey(['生年月日', '誕生日']);
          const genderKey    = findKey(['性別', '男・女']);
          const addressKey   = findKey(['住所', '所在地', '現住所']);
          const phoneKey     = findKey(['電話番号', '緊急連絡先', '携帯電話']);
          const officesKey   = findKey(['事業所', 'タグ', 'グループ', '備考']);
          const mPhoneKey     = findKey(['母電話', '(母)電話', '母親電話', '母携帯', '母の電話番号', '(母)電話番号', '母連絡先', '母の連絡先', '(母)連絡先'], ['職場', '勤務先']);
          const mWorkKey      = findKey(['母勤務先', '母の勤務先', '(母)勤務先', '母親勤務先', '母職場', '母の職場'], ['電話', '連絡先']);
          const mWorkContactKey = findKey(['母の職場電話', '母職場電話', '(母)職場連絡先', '母勤務先電話', '母職場連絡先', '母の職場連絡先']);
          const fPhoneKey     = findKey(['父電話', '(父)電話', '父親電話', '父携帯', '父の電話番号', '(父)電話番号', '父連絡先', '父の連絡先', '(父)連絡先'], ['職場', '勤務先']);
          const fWorkKey      = findKey(['父勤務先', '父の勤務先', '(父)勤務先', '父親勤務先', '父職場', '父の職場'], ['電話', '連絡先']);
          const fWorkContactKey = findKey(['父の職場電話', '父職場電話', '(父)職場連絡先', '父勤務先電話', '父職場連絡先', '父の職場連絡先']);
          const otherContactKey = findKey(['その他連絡', 'その他の連絡']);

          if (!nameKey) {
            alert(`エラー: 名前の列が見つかりませんでした。\n認識した列: ${headerKeys.join(', ')}`);
            return;
          }

          const mappedData = rawData.map((row, idx) => {
            const rawName = (row[nameKey] || '').trim();
            const nameParts = rawName.split(/[\s　]+/);
            const lastName = nameParts[0] || '';
            const firstName = nameParts.slice(1).join(' ') || '';
            
            const isDuplicate = children.some(c => (c.name === rawName) || (c.lastName === lastName && c.firstName === firstName));
            
            const rawFurigana = furiganaKey ? (row[furiganaKey] || '').trim() : '';
            const furiganaParts = rawFurigana.split(/[\s　]+/);
            const lastNameFurigana = furiganaParts[0] || '';
            const firstNameFurigana = furiganaParts.slice(1).join(' ') || '';

            const rawGender = genderKey ? (row[genderKey] || '').trim() : '';
            let mappedGender = '';
            if (['男', '男性', 'male'].includes(rawGender)) mappedGender = 'male';
            else if (['女', '女性', 'female'].includes(rawGender)) mappedGender = 'female';
            else if (rawGender) mappedGender = 'other';

            let c1Phone = mPhoneKey ? (row[mPhoneKey] || '').trim() : '';
            let c2Phone = fPhoneKey ? (row[fPhoneKey] || '').trim() : '';
            const genericPhoneText = phoneKey ? (row[phoneKey] || '').trim() : '';

            // Fallback parsing from generic "緊急連絡先" column if specific columns not found
            if (genericPhoneText) {
              if (!c1Phone) {
                const mMatch = genericPhoneText.match(/[(（]母[)）][^\d]*([\d\-]+)/);
                if (mMatch) c1Phone = mMatch[1];
              }
              if (!c2Phone) {
                const fMatch = genericPhoneText.match(/[(（]父[)）][^\d]*([\d\-]+)/);
                if (fMatch) c2Phone = fMatch[1];
              }
            }

            return {
              tempId: `preview_${idx}_${Date.now()}`,
              lastName,
              firstName,
              lastNameFurigana,
              firstNameFurigana,
              schoolName:       schoolKey    ? (row[schoolKey]    || '').trim() : '',
              schoolGrade:      gradeKey     ? (row[gradeKey]     || '').trim() : '',
              birthDate:        birthDateKey ? normalizeDate(row[birthDateKey]).replace(/-/g, '/') : '',
              gender:           mappedGender,
              address:          addressKey   ? (row[addressKey]   || '').trim() : '',
              phoneNumber:      genericPhoneText,
              contact1Phone:    c1Phone,
              workplace1Name:   mWorkKey     ? (row[mWorkKey]     || '').trim() : '',
              workplace1Contact:mWorkContactKey ? (row[mWorkContactKey] || '').trim() : '',
              contact2Phone:    c2Phone,
              workplace2Name:   fWorkKey     ? (row[fWorkKey]     || '').trim() : '',
              workplace2Contact:fWorkContactKey ? (row[fWorkContactKey] || '').trim() : '',
              otherContacts:    otherContactKey ? (row[otherContactKey] || '').trim() : '',
              offices: officesKey ? (row[officesKey] || '').split(/[,、\s]+/).filter(Boolean) : [],
              contact1Relation: '母',
              contact2Relation: '父',
              isDuplicate
            };
          }).filter(d => d.name);

          if (mappedData.length === 0) {
            alert('名前が見つかりませんでした。列名を確認してください。');
            return;
          }

          setImportPreviewData(mappedData);
          setShowImportPreview(true);
        },
        error: (err) => alert(`CSV解析エラー: ${err.message}`)
      });
    };
    reader.readAsArrayBuffer(file);
  };

  const executeImport = async () => {
    if (!importPreviewData || importPreviewData.length === 0) return;
    setIsImporting(true);
    
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    let mergeCount = 0;

    for (const data of importPreviewData) {
      // Skip duplicates if action is 'skip'
      if (data.isDuplicate && duplicateAction === 'skip') {
        skipCount++;
        continue;
      }

      const { tempId, isDuplicate, offices: csvOffices, ...saveData } = data;
      const mergedOffices = [...new Set([...(csvOffices || []), ...importCommonOffices])];
      
      try {
        if (isDuplicate && duplicateAction === 'merge') {
          // Find existing child
          const existingChild = children.find(c => 
            (c.name === (saveData.lastName + ' ' + saveData.firstName).trim()) || 
            (c.lastName === saveData.lastName && c.firstName === saveData.firstName)
          );
          if (existingChild) {
            const updatePayload = {};
            // Only update fields that have a value in CSV
            for (const [key, value] of Object.entries(saveData)) {
              if (value !== '' && value !== null && value !== undefined) {
                if (key === 'birthDate') {
                  updatePayload[key] = normalizeDate(value);
                } else {
                  updatePayload[key] = value;
                }
              }
            }
            if (mergedOffices.length > 0) {
              updatePayload.offices = [...new Set([...(existingChild.offices || existingChild.tags || []), ...mergedOffices])];
            }
            updatePayload.updatedAt = serverTimestamp();

            await updateDoc(doc(db, "children", existingChild.id), updatePayload);
            mergeCount++;
            continue;
          }
        }

        const newId = `child_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        await setDoc(doc(db, "children", newId), {
          ...saveData,
          birthDate: saveData.birthDate ? normalizeDate(saveData.birthDate) : '',
          offices: mergedOffices,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        successCount++;
      } catch (err) {
        console.error(`Import failed for ${data.name}:`, err);
        failCount++;
      }
    }

    setIsImporting(false);
    setShowImportPreview(false);
    setImportPreviewData(null);
    setImportCommonOffices([]);
    setDuplicateAction('skip');
    await writeLog("CSVインポート", `CSVファイルから児童データをインポートしました (新規登録: ${successCount}件, 統合: ${mergeCount}件, スキップ: ${skipCount}件)`);
    let msg = `${successCount} 件のデータを登録しました`;
    if (mergeCount > 0) msg += ` (統合 ${mergeCount} 件)`;
    if (skipCount > 0) msg += ` (スキップ ${skipCount} 件)`;
    if (failCount > 0) msg += ` (失敗 ${failCount} 件)`;
    showToast(msg);
  };

  const handlePreviewChange = (tempId, field, value) => {
    setImportPreviewData(prev => prev.map(d => 
      d.tempId === tempId ? { ...d, [field]: value } : d
    ));
  };

  // =====================
  // Delete / Archive
  // =====================
  const handleDeleteChild = async (id) => {
    if (!window.confirm('この児童のデータを完全に削除します。元に戻せません。本当によろしいですか？')) return;
    try {
      const child = children.find(c => c.id === id);
      const childName = child ? (child.lastName ? `${child.lastName} ${child.firstName}` : child.name || '未設定') : '未設定';
      await deleteDoc(doc(db, 'children', id));
      await writeLog("完全に削除", `${childName}君のデータを完全に削除しました`, child?.staffInCharge);
      if (selectedId === id) setSelectedId(null);
      showToast('削除しました');
    } catch (err) {
      alert(`削除失敗: ${err.message}`);
    }
  };

  const handleArchiveChild = async (id, currentArchived) => {
    if (!currentArchived) {
      if (!window.confirm('この児童をアーカイブします。よろしいですか？')) return;
    }
    try {
      await updateDoc(doc(db, 'children', id), { archived: !currentArchived, updatedAt: serverTimestamp() });
      const child = children.find(c => c.id === id);
      const childName = child ? (child.lastName ? `${child.lastName} ${child.firstName}` : child.name || '未設定') : '未設定';
      await writeLog(
        !currentArchived ? "アーカイブ" : "アーカイブ解除",
        `${childName}君を${!currentArchived ? 'アーカイブしました' : 'アーカイブから復帰させました'}`,
        child?.staffInCharge
      );
      showToast(!currentArchived ? 'アーカイブしました' : 'アーカイブを解除しました');
    } catch (err) {
      alert(`操作失敗: ${err.message}`);
    }
  };

  const handleBulkArchive = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`${selectedIds.size} 件のデータをアーカイブします。よろしいですか？`)) return;
    const count = selectedIds.size;
    for (const id of selectedIds) {
      try {
        const child = children.find(c => c.id === id);
        const childName = child ? (child.lastName ? `${child.lastName} ${child.firstName}` : child.name || '未設定') : '未設定';
        await updateDoc(doc(db, 'children', id), { archived: true, updatedAt: serverTimestamp() });
        await writeLog("一括アーカイブ", `${childName}君を一括操作でアーカイブしました`, child?.staffInCharge);
      } catch (err) { console.error(err); }
    }
    showToast(`${count} 件をアーカイブしました`);
    setSelectedIds(new Set());
    setIsBulkMode(false);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`${selectedIds.size} 件のデータを完全に削除します。元に戻せません。本当によろしいですか？`)) return;
    const ids = [...selectedIds];
    for (const id of ids) {
      try {
        const child = children.find(c => c.id === id);
        const childName = child ? (child.lastName ? `${child.lastName} ${child.firstName}` : child.name || '未設定') : '未設定';
        await deleteDoc(doc(db, 'children', id));
        await writeLog("一括完全に削除", `${childName}君を一括操作で完全に削除しました`, child?.staffInCharge);
      } catch (err) { console.error(err); }
    }
    if (selectedId && selectedIds.has(selectedId)) setSelectedId(null);
    showToast(`${ids.length} 件を削除しました`);
    setSelectedIds(new Set());
    setIsBulkMode(false);
  };


  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div 
      className="flex h-screen bg-slate-50 overflow-hidden font-sans relative select-none"
      style={{ overscrollBehaviorX: 'none' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      
      {/* Edge Swipe Reaction Zone (Invisible) */}
      <div 
        className="fixed inset-y-0 left-0 w-8 z-30 touch-none pointer-events-auto"
        onMouseDown={() => setIsSidebarOpen(true)}
      />

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-30 touch-none"
          />
        )}
      </AnimatePresence>

      {/* Sidebar (Drawer for all sizes) */}
      <motion.aside 
        drag="x"
        dragConstraints={{ left: -320, right: 0 }}
        dragElastic={0.05}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -100) setIsSidebarOpen(false);
          else if (info.offset.x > 100) setIsSidebarOpen(true);
          else if (info.point.x < 160) setIsSidebarOpen(false);
        }}
        animate={{ x: isSidebarOpen ? 0 : -320 }}
        initial={{ x: -320 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className={cn(
          "w-[320px] bg-white border-r border-slate-200 flex flex-col z-40 shadow-2xl fixed inset-y-0 left-0 touch-none",
          !isSidebarOpen && "pointer-events-none"
        )}
        onMouseLeave={() => {
          if (window.innerWidth >= 768) setIsSidebarOpen(false);
        }}
      >
        <div className="p-6 border-b border-slate-100 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black font-outfit text-slate-800 tracking-tight">顧客管理</h2>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-full uppercase tracking-wider">{children.length} 名</span>
            </div>
          </div>
          
          <button 
            onClick={() => setIsModalOpen(true)}
            className="w-full bg-slate-900 text-white py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-all hover:scale-[1.02] active:scale-95 shadow-md shadow-slate-200"
          >
            <PlusCircle className="w-4 h-4" />
            新規児童を登録
          </button>

          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-full bg-white border border-slate-200 text-slate-600 py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-50 transition-all hover:scale-[1.02] active:scale-95 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            CSVインポート
          </button>
          <input 
            type="file" 
            accept=".csv" 
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors"
            >
              {sortOrder === 'asc' ? <ArrowUpAZ className="w-4 h-4" /> : <ArrowDownAZ className="w-4 h-4" />}
              {sortOrder === 'asc' ? 'あ→ん' : 'ん→あ'}
            </button>
            <button
              onClick={() => setShowOfficeFilter(f => !f)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors border",
                showOfficeFilter || activeOfficeFilter
                  ? "bg-brand-500 text-white border-brand-500"
                  : "bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100"
              )}
            >
              <Tag className="w-4 h-4" />
              {activeOfficeFilter || '事業所'}
            </button>
            <button
              onClick={toggleBulkMode}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors border",
                isBulkMode
                  ? "bg-violet-500 text-white border-violet-500"
                  : "bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100"
              )}
            >
              <CheckSquare className="w-4 h-4" />
              {isBulkMode ? `${selectedIds.size}選` : '一括'}
            </button>
            <button
              onClick={() => setShowArchived(v => !v)}
              title={showArchived ? 'アーカイブ非表示' : 'アーカイブを表示'}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors border shrink-0",
                showArchived
                  ? "bg-slate-600 text-white border-slate-600"
                  : "bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100"
              )}
            >
              <Archive className="w-4 h-4" />
              {showArchived ? '表示中' : '表示'}
            </button>
          </div>

          {/* Office filter chips */}
          {showOfficeFilter && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => { setActiveOfficeFilter(null); setShowOfficeFilter(false); }}
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-bold border transition-all",
                  activeOfficeFilter === null ? "bg-slate-800 text-white border-slate-800" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                )}
              >
                全員
              </button>
              {allOffices.map(office => (
                <button
                  key={office}
                  onClick={() => { setActiveOfficeFilter(t => t === office ? null : office); setShowOfficeFilter(false); }}
                  className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-bold border transition-all",
                    activeOfficeFilter === office ? "bg-brand-500 text-white border-brand-500" : "bg-white border-slate-200 text-slate-500 hover:bg-brand-50 hover:border-brand-200"
                  )}
                >
                  {office}
                </button>
              ))}
              {allOffices.length === 0 && <span className="text-[10px] text-slate-400 px-1">事業所がまだありません</span>}
            </div>
          )}

          {/* Bulk mode toolbar */}
          {isBulkMode && (
            <div className="flex flex-col gap-2 p-3 bg-violet-50 rounded-2xl border border-violet-100">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-violet-600 uppercase tracking-widest">{selectedIds.size} 件選択中</span>
                <div className="flex gap-1">
                  <button onClick={selectAll} className="text-[10px] font-bold text-violet-500 hover:text-violet-700 px-2">全選択</button>
                  <button onClick={deselectAll} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 px-2">解除</button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => setBulkOfficeModalOpen(true)}
                  disabled={selectedIds.size === 0}
                  className="flex items-center justify-center gap-1 py-2 bg-violet-500 text-white rounded-xl text-[10px] font-bold hover:bg-violet-600 transition-colors disabled:opacity-40"
                >
                  <Tag className="w-3 h-3" />
                  事業所
                </button>
                <button
                  onClick={handleBulkArchive}
                  disabled={selectedIds.size === 0}
                  className="flex items-center justify-center gap-1 py-2 bg-slate-500 text-white rounded-xl text-[10px] font-bold hover:bg-slate-600 transition-colors disabled:opacity-40"
                >
                  <Archive className="w-3 h-3" />
                  アーカイブ
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={selectedIds.size === 0}
                  className="flex items-center justify-center gap-1 py-2 bg-rose-500 text-white rounded-xl text-[10px] font-bold hover:bg-rose-600 transition-colors disabled:opacity-40"
                >
                  <Trash className="w-3 h-3" />
                  一括削除
                </button>
              </div>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="名前で検索..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:bg-white focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {filteredChildren.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs font-bold mt-10">児童が見つかりません</div>
          ) : (
            filteredChildren.map(child => (
              <button 
                key={child.id}
                onClick={() => {
                  if (isBulkMode) { toggleSelectChild(child.id); }
                  else { 
                    setSelectedId(child.id);
                    setIsSidebarOpen(false);
                  }
                }}
                className={cn(
                  "w-full text-left p-4 rounded-2xl flex items-center gap-3 transition-all relative group",
                  isBulkMode && selectedIds.has(child.id) ? "bg-violet-50 border border-violet-200" :
                  selectedId === child.id && !isBulkMode ? "bg-brand-50 text-brand-700 shadow-sm" : "hover:bg-slate-50"
                )}
              >
                {!isBulkMode && selectedId === child.id && (
                  <motion.div layoutId="active-nav" className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-brand-500 rounded-r-full" />
                )}
                {isBulkMode ? (
                  <div className={cn(
                    "w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors",
                    selectedIds.has(child.id) ? "bg-violet-500 border-violet-500" : "border-slate-300"
                  )}>
                    {selectedIds.has(child.id) && <Check className="w-3.5 h-3.5 text-white" />}
                  </div>
                ) : (
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-colors shrink-0",
                    selectedId === child.id ? "bg-white text-brand-600" : "bg-slate-100 text-slate-400 group-hover:bg-slate-200"
                  )}>
                    {((child.lastName || child.name || '?')[0])}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate flex items-center gap-2">
                    <span className={cn(child.archived && "text-slate-400")}>
                      {child.lastName ? `${child.lastName} ${child.firstName}` : child.name || '未設定'}
                    </span>
                    {child.archived && <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded font-black shrink-0">アーカイブ</span>}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate opacity-80">{child.schoolName || ''} {child.schoolGrade || ''}</div>
                  {(() => {
                    const offs = Array.isArray(child.offices) ? child.offices : Array.isArray(child.tags) ? child.tags : [];
                    return offs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {offs.slice(0, 3).map(office => (
                          <span key={office} className="px-1.5 py-0.5 bg-brand-50 text-brand-500 rounded text-[9px] font-bold border border-brand-100">{office}</span>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                {!isBulkMode && <ChevronRight className={cn(
                  "w-4 h-4 text-slate-300 transition-transform",
                  selectedId === child.id ? "translate-x-1 text-brand-400" : "opacity-0 group-hover:opacity-100"
                )} />}
              </button>
            ))
          )}
        </div>
      </motion.aside>

      {/* Top Header (Visible on all sizes) */}
      <header className="fixed top-0 left-0 right-0 h-16 bg-white/80 backdrop-blur-xl border-b border-slate-100 flex items-center justify-between px-6 z-20">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-2 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <Menu className="w-6 h-6 text-slate-600" />
          </button>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-black text-slate-800 tracking-tight font-outfit">顧客管理</h1>
            <button
              onClick={() => setIsLogModalOpen(true)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all shadow-sm"
            >
              ログ
            </button>
            <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-100">
              v2026.06.06.1619
            </span>
          </div>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="w-10 h-10 bg-brand-500 text-white rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/20"
        >
          <PlusCircle className="w-5 h-5" />
        </button>
      </header>

      {/* Main Content */}
      <main className={cn(
        "flex-1 h-full overflow-y-auto custom-scrollbar relative p-4 md:p-8 pt-20 md:pt-24 pb-32 md:pb-8 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:32px_32px] transition-all",
        isSidebarOpen ? "overflow-hidden touch-none pointer-events-none brightness-95" : "overscroll-none"
      )}>
        
        <AnimatePresence mode="wait">
          {!selectedChild ? (
            <motion.div 
              key="empty"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="h-full flex flex-col items-center justify-center text-slate-400 space-y-6"
            >
              <div className="w-24 h-24 bg-white rounded-[2.5rem] shadow-premium flex items-center justify-center text-slate-200">
                <User className="w-12 h-12" />
              </div>
              <div className="text-center">
                <p className="font-black text-xl text-slate-400 tracking-tight">児童を選択して詳細を表示</p>
                <p className="text-sm mt-1">左のリストから管理する児童を選んでください</p>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key={selectedId}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-5xl mx-auto space-y-6 pb-20 pt-4"
            >
              {/* 1. Profile Metadata Header */}
              <div className="flex flex-col md:flex-row justify-between items-center px-4 text-slate-400 font-bold text-[10px] uppercase tracking-[0.2em] gap-4">
                <div className="flex items-center gap-4 bg-white px-6 py-2 rounded-full border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3 h-3 text-brand-500" />
                    <span>記入日:</span>
                    <input type="date" value={formData.entryDate || ''} onChange={e => handleChange('entryDate', e.target.value)} className="bg-transparent border-none focus:ring-0 text-slate-700 font-bold text-[11px]" />
                  </div>
                </div>
                <div className="flex items-center gap-4 bg-white px-6 py-2 rounded-full border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-2">
                    <User className="w-3 h-3 text-brand-500" />
                    <span>担当者:</span>
                    <input type="text" placeholder="氏名を入力" value={formData.staffInCharge || ''} onChange={e => handleChange('staffInCharge', e.target.value)} className="bg-transparent border-none focus:ring-0 text-slate-700 font-bold text-[11px] w-24" />
                  </div>
                </div>
              </div>

              {/* 2. Banner / Profile Header */}
              <header className="bg-white/80 backdrop-blur-xl p-6 md:p-8 rounded-[2rem] md:rounded-[3rem] shadow-premium flex flex-col md:flex-row items-center gap-6 md:gap-8 border border-white/40 relative">
                <div className="w-24 h-24 bg-brand-500 text-white rounded-[2.5rem] flex items-center justify-center text-3xl font-black shadow-lg shadow-brand-500/20 shrink-0">
                  {(formData.lastName || formData.name || '?')[0]}
                </div>
                <div className="flex-1 text-center md:text-left">
                  {/* Offices above name */}
                  <div className="flex flex-wrap justify-center md:justify-start gap-1.5 mb-3">
                    {(Array.isArray(formData.offices) ? formData.offices : Array.isArray(formData.tags) ? formData.tags : []).map(office => (
                      <span key={office} className="px-2 py-0.5 bg-brand-50 text-brand-600 rounded-lg text-[9px] font-black uppercase tracking-wider border border-brand-100 flex items-center gap-1">
                        {office}
                        {isEditing && (
                          <button onClick={() => removeOffice(office)} className="hover:text-red-500 transition-colors">
                            <X className="w-2 h-2" />
                          </button>
                        )}
                      </span>
                    ))}
                    {isEditing && masterOffices.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {masterOffices.filter(o => !(Array.isArray(formData.offices) ? formData.offices : Array.isArray(formData.tags) ? formData.tags : []).includes(o)).map(office => (
                          <button
                            key={office}
                            onClick={() => handleChange('offices', [...(Array.isArray(formData.offices) ? formData.offices : Array.isArray(formData.tags) ? formData.tags : []), office])}
                            className="px-2 py-0.5 bg-white border border-slate-200 text-slate-400 rounded-lg text-[9px] font-bold hover:border-brand-300 hover:text-brand-500 transition-all"
                          >
                            + {office}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col md:flex-row md:items-end gap-3 mb-4">
                    {isEditing ? (
                      <div className="flex gap-4 flex-1">
                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-[10px] font-black text-brand-500 uppercase tracking-widest px-1">姓</label>
                          <input 
                            type="text" 
                            value={formData.lastName || ''} 
                            onChange={e => handleChange('lastName', e.target.value)} 
                            className="text-4xl font-black text-slate-800 tracking-tight bg-slate-50 rounded-2xl px-4 py-2 border-none focus:ring-4 focus:ring-brand-500/10 outline-none w-full"
                          />
                        </div>
                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-[10px] font-black text-brand-500 uppercase tracking-widest px-1">名</label>
                          <input 
                            type="text" 
                            value={formData.firstName || ''} 
                            onChange={e => handleChange('firstName', e.target.value)} 
                            className="text-4xl font-black text-slate-800 tracking-tight bg-slate-50 rounded-2xl px-4 py-2 border-none focus:ring-4 focus:ring-brand-500/10 outline-none w-full"
                          />
                        </div>
                      </div>
                    ) : (
                      <h1 className="text-4xl font-black text-slate-800 tracking-tight">
                        {formData.lastName ? `${formData.lastName} ${formData.firstName}` : formData.name || '未設定'}
                      </h1>
                    )}
                    
                    <div className="flex flex-col gap-1">
                      {isEditing && <label className="text-[10px] font-black text-brand-500 uppercase tracking-widest px-1">ふりがな</label>}
                      <div className={cn(
                        "text-brand-500 font-bold px-3 py-1 bg-brand-50 rounded-full text-[10px] uppercase tracking-widest leading-none flex items-center gap-2",
                        isEditing && "bg-slate-50 text-slate-400 py-2 rounded-xl"
                      )}>
                        {isEditing ? (
                          <>
                            <input 
                              type="text" 
                              value={formData.lastNameFurigana || ''} 
                              onChange={e => handleChange('lastNameFurigana', e.target.value)} 
                              className="bg-transparent border-none p-0 focus:ring-0 text-[10px] font-bold w-16"
                              placeholder="せい"
                            />
                            <input 
                              type="text" 
                              value={formData.firstNameFurigana || ''} 
                              onChange={e => handleChange('firstNameFurigana', e.target.value)} 
                              className="bg-transparent border-none p-0 focus:ring-0 text-[10px] font-bold w-16"
                              placeholder="めい"
                            />
                          </>
                        ) : (
                          formData.lastNameFurigana ? `${formData.lastNameFurigana} ${formData.firstNameFurigana}` : formData.nameFurigana || 'ふりがななし'
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-center md:justify-start gap-4 text-xs font-bold text-slate-500">
                    <div className={cn("flex items-center gap-2 px-3 py-2 bg-white rounded-xl shadow-sm border border-slate-100", isEditing && "bg-slate-50 border-brand-200")}>
                       <Calendar className="w-4 h-4 text-brand-500" /> 
                       {isEditing ? (
                         <input 
                           type="date" 
                           value={formData.birthDate || ''} 
                           onChange={e => handleChange('birthDate', e.target.value)} 
                           className="bg-transparent border-none p-0 focus:ring-0 text-xs font-bold w-32"
                         />
                       ) : (
                         <div className="flex items-center gap-1.5">
                           <span>{formatDateForDisplay(formData.birthDate)}</span>
                           {formData.birthDate && (
                             <div className="flex items-center gap-1">
                               <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-black">
                                 {calculateAgeAndGrade(formData.birthDate).age}歳
                               </span>
                               <span className="text-[10px] bg-brand-500 text-white px-1.5 py-0.5 rounded font-black">
                                 {calculateAgeAndGrade(formData.birthDate).grade}
                               </span>
                             </div>
                           )}
                         </div>
                       )}
                    </div>
                    <div className={cn("flex items-center gap-2 px-3 py-2 bg-white rounded-xl shadow-sm border border-slate-100", isEditing && "bg-slate-50 border-emerald-200")}>
                       <User className="w-4 h-4 text-emerald-500" /> 
                       {isEditing ? (
                         <select 
                           value={formData.gender || ''} 
                           onChange={e => handleChange('gender', e.target.value)} 
                           className="bg-transparent border-none p-0 focus:ring-0 text-xs font-bold pr-6"
                         >
                           <option value="">性別を選択</option>
                           <option value="male">男性</option>
                           <option value="female">女性</option>
                           <option value="other">その他</option>
                         </select>
                       ) : (
                         <span>{formData.gender === 'male' ? '男性' : formData.gender === 'female' ? '女性' : 'その他'}</span>
                       )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 w-full md:w-auto">
                  {!isEditing ? (
                    <button 
                      onClick={() => setIsEditing(true)}
                      className="btn-primary min-w-[140px] shadow-lg shadow-brand-500/20 bg-slate-800"
                    >
                      <PlusCircle className="w-4 h-4 rotate-45" />
                      編集を開始
                    </button>
                  ) : (
                    <button 
                      onClick={handleSave}
                      disabled={isSaving}
                      className="btn-primary min-w-[140px] shadow-lg shadow-brand-500/20"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" /> }
                      内容を保存
                    </button>
                  )}
                  <button
                    onClick={() => handleArchiveChild(selectedId, selectedChild?.archived)}
                    className={cn(
                      "flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl font-bold text-sm transition-all",
                      selectedChild?.archived
                        ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        : "bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-700"
                    )}
                  >
                    {selectedChild?.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                    {selectedChild?.archived ? 'アーカイブ解除' : 'アーカイブ'}
                  </button>
                  {selectedChild?.archived && (
                    <button
                      onClick={() => handleDeleteChild(selectedId)}
                      className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl font-bold text-sm transition-all bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                    >
                      <Trash className="w-4 h-4" />
                      完全に削除
                    </button>
                  )}
                </div>
              </header>

              {/* 3. Bento Dashboard Grid */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                


                {/* 3.2 Address & Workplaces (12) */}
                <section className="bento-card p-8 md:col-span-12 space-y-6">
                  <h3 className="flex items-center gap-2.5 font-black text-slate-800 text-sm uppercase tracking-widest border-b border-slate-100 pb-4">
                    <Smartphone className="w-4 h-4 text-emerald-500" /> 所在地・職場連絡先
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="md:col-span-1 space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">現住所</label>
                        <textarea readOnly={!isEditing} value={formData.address || ''} onChange={e => handleChange('address', e.target.value)} className={cn("input-standard min-h-[80px]", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="〒 所在地" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">その他の連絡先</label>
                        <textarea readOnly={!isEditing} value={formData.otherContacts || ''} onChange={e => handleChange('otherContacts', e.target.value)} className={cn("input-standard min-h-[60px]", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="祖父母の連絡先など" />
                      </div>
                    </div>
                    <div className="md:col-span-1 space-y-4 p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">連絡先① & 職場</label>
                      <input type="text" readOnly={!isEditing} value={formData.contact1Relation || ''} onChange={e => handleChange('contact1Relation', e.target.value)} className={cn("input-standard mb-2 font-bold", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="続柄 (例: 母)" />
                      <input type="tel" readOnly={!isEditing} value={formData.contact1Phone || ''} onChange={e => handleChange('contact1Phone', e.target.value)} className={cn("input-standard mb-2 font-bold text-brand-600", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="個人の電話番号" />
                      <input type="text" readOnly={!isEditing} value={formData.workplace1Name || ''} onChange={e => handleChange('workplace1Name', e.target.value)} className={cn("input-standard mb-1 text-xs", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="会社名" />
                      <input type="tel" readOnly={!isEditing} value={formData.workplace1Contact || ''} onChange={e => handleChange('workplace1Contact', e.target.value)} className={cn("input-standard text-xs", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="職場電話" />
                    </div>
                    <div className="md:col-span-1 space-y-4 p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">連絡先② & 職場</label>
                      <input type="text" readOnly={!isEditing} value={formData.contact2Relation || ''} onChange={e => handleChange('contact2Relation', e.target.value)} className={cn("input-standard mb-2 font-bold", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="続柄 (例: 父)" />
                      <input type="tel" readOnly={!isEditing} value={formData.contact2Phone || ''} onChange={e => handleChange('contact2Phone', e.target.value)} className={cn("input-standard mb-2 font-bold text-brand-600", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="個人の電話番号" />
                      <input type="text" readOnly={!isEditing} value={formData.workplace2Name || ''} onChange={e => handleChange('workplace2Name', e.target.value)} className={cn("input-standard mb-1 text-xs", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="会社名" />
                      <input type="tel" readOnly={!isEditing} value={formData.workplace2Contact || ''} onChange={e => handleChange('workplace2Contact', e.target.value)} className={cn("input-standard text-xs", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="職場電話" />
                    </div>
                  </div>
                </section>

                {/* 3.3 School (12) */}
                <section className="bento-card p-6 md:col-span-12 flex flex-col md:flex-row items-center gap-6">
                  <h3 className="flex items-center gap-2.5 font-black text-slate-800 text-sm uppercase tracking-widest shrink-0">
                    <School className="w-4 h-4 text-indigo-500" /> 在籍校・園
                  </h3>
                  <div className="flex-1 flex gap-4 w-full">
                    <input type="text" readOnly={!isEditing} value={formData.schoolName || ''} onChange={e => handleChange('schoolName', e.target.value)} className={cn("input-standard font-bold", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="学校名・保育園名" />
                    <div className="flex items-center gap-2 shrink-0">
                      <input type="text" readOnly={!isEditing} value={formData.schoolGrade || ''} onChange={e => handleChange('schoolGrade', e.target.value)} className={cn("input-standard w-20 text-center", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} />
                      <span className="text-xs font-bold text-slate-400">学年</span>
                    </div>
                  </div>
                </section>

                {/* 3.4 Family Table (12) */}
                <section className="bento-card p-8 md:col-span-12 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <h3 className="flex items-center gap-2.5 font-black text-slate-800 text-sm uppercase tracking-widest">
                      <Users className="w-4 h-4 text-brand-500" /> 家族構成
                    </h3>
                    {isEditing && (
                      <button onClick={addFamilyMember} className="bg-brand-50 text-brand-500 px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-1.5 hover:bg-brand-100 transition-colors">
                        <PlusCircle className="w-3.5 h-3.5" /> 行を追加
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400 font-black uppercase tracking-widest text-[9px]">
                          <th className="text-left pb-4 px-2 tracking-tighter">名前</th>
                          <th className="text-left pb-4 px-2 w-16">年齢</th>
                          <th className="text-left pb-4 px-2">連絡先</th>
                          <th className="text-left pb-4 px-2">住所・備考</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {(formData.familyMembers || []).map((m, idx) => (
                          <tr key={idx} className="group">
                            <td className="py-2 px-2"><input readOnly={!isEditing} value={m.name || ''} onChange={e => handleFamilyChange(idx, 'name', e.target.value)} className={cn("w-full bg-transparent border-none p-1 font-bold focus:ring-0", !isEditing && "cursor-default")} /></td>
                            <td className="py-2 px-2"><input readOnly={!isEditing} value={m.age || ''} onChange={e => handleFamilyChange(idx, 'age', e.target.value)} className={cn("w-full bg-transparent border-none p-1 text-center focus:ring-0", !isEditing && "cursor-default")} /></td>
                            <td className="py-2 px-2"><input readOnly={!isEditing} value={m.contact || ''} onChange={e => handleFamilyChange(idx, 'contact', e.target.value)} className={cn("w-full bg-transparent border-none p-1 focus:ring-0", !isEditing && "cursor-default")} /></td>
                            <td className="py-2 px-2"><input readOnly={!isEditing} value={m.address || ''} onChange={e => handleFamilyChange(idx, 'address', e.target.value)} className={cn("w-full bg-transparent border-none p-1 focus:ring-0", !isEditing && "cursor-default")} /></td>
                            <td className="text-right">
                              {isEditing && (
                                <button onClick={() => removeFamilyMember(idx)} className="p-1.5 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-4 h-4" /></button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>



                {/* 3.5 Disability & Character (Row) */}
                <section className="bento-card p-8 md:col-span-7 space-y-6">
                  <h3 className="flex items-center gap-2.5 font-black text-slate-800 text-sm uppercase tracking-widest border-b border-slate-100 pb-4">
                    <Activity className="w-4 h-4 text-rose-500" /> 障がい・診断について
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">診断名・障がい名</label>
                      <input readOnly={!isEditing} value={formData.disabilityName || ''} onChange={e => handleChange('disabilityName', e.target.value)} className={cn("input-standard font-bold", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">手帳の種類</label>
                      <select disabled={!isEditing} value={formData.certificateType || ''} onChange={e => handleChange('certificateType', e.target.value)} className={cn("input-standard", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0 appearance-none pointer-events-none")}>
                        <option value="">未選択</option>
                        <option value="療育">療育手帳</option>
                        <option value="身体">身体障害者手帳</option>
                        <option value="精神">精神障害者保健福祉手帳</option>
                        <option value="受給者証のみ">受給者証のみ</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">級・度</label>
                      <input readOnly={!isEditing} value={formData.certificateGrade || ''} onChange={e => handleChange('certificateGrade', e.target.value)} className={cn("input-standard", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} />
                    </div>
                  </div>
                </section>

                <section className="bento-card p-8 md:col-span-5 space-y-6">
                  <h3 className="flex items-center gap-2.5 font-black text-slate-800 text-sm uppercase tracking-widest border-b border-slate-100 pb-4">
                    <Sparkles className="w-4 h-4 text-amber-500" /> 本人の性格
                  </h3>
                  <textarea readOnly={!isEditing} value={formData.personality || ''} onChange={e => handleChange('personality', e.target.value)} className={cn("input-standard min-h-[100px]", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="本人の性格的な特徴、強み..." />
                </section>

                {/* 3.6 Targets / Desires (Dark Mode) (12) */}
                <section className="bento-card p-8 md:col-span-12 bg-slate-900 text-white space-y-4 shadow-2xl">
                   <h3 className="flex items-center gap-2.5 font-black text-slate-400 text-sm uppercase tracking-widest opacity-80">
                    <Target className="w-4 h-4 text-brand-400" /> 望む事（保護者・本人からの要望）
                  </h3>
                  <textarea readOnly={!isEditing} value={formData.desiredSupport || ''} onChange={e => handleChange('desiredSupport', e.target.value)} className={cn("w-full p-4 bg-white/10 border border-white/20 rounded-2xl text-sm leading-relaxed focus:bg-white/20 focus:outline-none min-h-[140px] transition-all", !isEditing && "bg-transparent border-none shadow-none px-0 py-0 focus:bg-transparent cursor-default")} placeholder="将来の希望や、現在取り組みたいこと..." />
                </section>

                {/* 3.7 Remarks & Allergies (12) */}
                <section className="bento-card p-8 md:col-span-12 space-y-6">
                  <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-slate-100 pb-6">
                    <h3 className="flex items-center gap-2.5 font-black text-slate-800 text-sm uppercase tracking-widest">
                      <StickyNote className="w-4 h-4 text-slate-400" /> 備考・アレルギー
                    </h3>
                    <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                      <span className="text-[10px] font-black text-slate-400 px-3 uppercase tracking-widest">アレルギー:</span>
                      <button onClick={() => handleChange('allergies', '無')} className={cn("px-4 py-1.5 rounded-xl text-xs font-bold transition-all", formData.allergies === '無' ? "bg-white shadow text-slate-700" : "text-slate-400 hover:text-slate-600")}>無</button>
                      <button onClick={() => handleChange('allergies', '有')} className={cn("px-4 py-1.5 rounded-xl text-xs font-bold transition-all", formData.allergies === '有' ? "bg-rose-500 text-white shadow-lg" : "text-slate-400 hover:text-slate-600")}>有</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">アレルギー詳細</label>
                      <textarea readOnly={!isEditing} value={formData.allergiesDetail || ''} onChange={e => handleChange('allergiesDetail', e.target.value)} className={cn("input-standard min-h-[100px]", formData.allergies === '有' ? "bg-rose-50/20" : "", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="具体的な種類や注意点など..." />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">その他特記事項</label>
                      <textarea readOnly={!isEditing} value={formData.memo || ''} onChange={e => handleChange('memo', e.target.value)} className={cn("input-standard min-h-[100px]", !isEditing && "bg-transparent border-none shadow-none px-1 py-0 h-auto focus:ring-0")} placeholder="特記事項..." />
                    </div>
                  </div>
                </section>


                {/* その他メモ (12) */}
                <section className="bento-card p-8 md:col-span-12">
                  <h3 className="flex items-center gap-2.5 font-black text-slate-800 text-sm uppercase tracking-widest mb-6">
                    <StickyNote className="w-4 h-4 text-slate-400" /> 
                    自由記述メモ (スタッフ間共有)
                  </h3>
                  <textarea 
                    value={formData.memo || ''}
                    onChange={e => handleChange('memo', e.target.value)}
                    className="input-standard min-h-[120px] leading-relaxed" 
                    placeholder="その他の重要な情報..."
                  />
                </section>

                {/* Edit Basic Info Section */}
                <section className="md:col-span-12 p-8 rounded-[3rem] bg-slate-100/50 border border-dashed border-slate-300">
                  <h4 className="text-xs font-bold text-slate-500 mb-6 uppercase tracking-[0.2em] text-center">基本情報の詳細編集</h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">姓</label>
                       <input value={formData.lastName || ''} onChange={e => handleChange('lastName', e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">名</label>
                       <input value={formData.firstName || ''} onChange={e => handleChange('firstName', e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">姓ふりがな</label>
                       <input value={formData.lastNameFurigana || ''} onChange={e => handleChange('lastNameFurigana', e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">名ふりがな</label>
                       <input value={formData.firstNameFurigana || ''} onChange={e => handleChange('firstNameFurigana', e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">学校名</label>
                       <input value={formData.schoolName || ''} onChange={e => handleChange('schoolName', e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">学年</label>
                       <input value={formData.schoolGrade || ''} onChange={e => handleChange('schoolGrade', e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">電話番号</label>
                       <input value={formData.phoneNumber || ''} onChange={e => handleChange('phoneNumber', e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-bold" />
                    </div>
                  </div>
                </section>

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Navigation with Persistent Search Results */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-2xl border-t border-slate-100 px-6 py-4 z-20 pb-safe shadow-[0_-20px_50px_rgba(0,0,0,0.1)]">
        
        {/* Quick Search Results Popover */}
        <AnimatePresence>
          {searchQuery && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-[calc(100%+1px)] left-0 right-0 max-h-[60vh] bg-white/95 backdrop-blur-xl border-t border-slate-100 overflow-y-auto shadow-2xl p-4 custom-scrollbar"
            >
              <div className="flex flex-col gap-1">
                <div className="px-3 pb-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">検索結果: {filteredChildren.length}件</span>
                  <button onClick={() => setSearchQuery('')} className="text-[10px] font-black text-brand-500 uppercase tracking-widest">クリア</button>
                </div>
                {filteredChildren.length > 0 ? (
                  filteredChildren.map(child => (
                    <button 
                      key={child.id}
                      onClick={() => {
                        setSelectedId(child.id);
                        setSearchQuery('');
                        setIsSidebarOpen(false);
                      }}
                      className="flex items-center gap-4 p-3 hover:bg-slate-50 rounded-2xl transition-colors text-left group"
                    >
                      <div className="w-10 h-10 bg-brand-50 text-brand-500 rounded-xl flex items-center justify-center font-black transition-transform group-active:scale-90">
                        {(child.lastName || child.name || '?')[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-700 truncate">{child.lastName} {child.firstName}</div>
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate">{child.lastNameFurigana} {child.firstNameFurigana}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </button>
                  ))
                ) : (
                  <div className="text-center py-12 flex flex-col items-center gap-3">
                    <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center">
                      <Search className="w-6 h-6 text-slate-200" />
                    </div>
                    <p className="text-slate-400 font-bold text-sm tracking-tight">見つかりませんでした</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="児童を検索..."
              className="w-full pl-10 pr-4 py-3 bg-slate-100/50 border-none rounded-2xl text-base font-bold focus:bg-white focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
            />
          </div>

          <button 
            onClick={() => { setSelectedId(null); setIsSidebarOpen(true); }}
            className="flex flex-col items-center gap-1 text-slate-400 shrink-0"
          >
            <Users className={cn("w-6 h-6", !selectedId && "text-brand-500")} />
            <span className="text-[10px] font-bold">一覧</span>
          </button>
        </div>
      </nav>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className="fixed bottom-10 left-1/2 bg-slate-900 px-8 py-4 rounded-full shadow-2xl text-white font-bold text-sm tracking-wide z-50 flex items-center gap-3"
          >
            <div className="w-5 h-5 bg-brand-500 rounded-full flex items-center justify-center text-[10px] text-white">✓</div>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Log Viewer Modal */}
      <AnimatePresence>
        {isLogModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsLogModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl p-6 md:p-8 border border-white max-h-[85vh] flex flex-col"
            >
              <button 
                onClick={() => setIsLogModalOpen(false)}
                className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-full transition-colors z-10"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
              
              <div className="mb-6 pr-8">
                <h2 className="text-2xl font-black text-slate-800 tracking-tight">操作履歴ログ</h2>
                <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-1">System change history (Last 100 entries)</p>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2 min-h-[300px]">
                {isLoadingLogs ? (
                  <div className="h-48 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
                  </div>
                ) : logs.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-slate-400 text-sm font-bold">
                    操作履歴はありません
                  </div>
                ) : (
                  logs.map((log) => {
                    const date = log.timestamp?.seconds 
                      ? new Date(log.timestamp.seconds * 1000) 
                      : new Date();
                    const formattedTime = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
                    
                    return (
                      <div key={log.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-xs font-bold text-slate-700 bg-slate-200/60 px-2.5 py-1 rounded-lg shrink-0">
                            担当: {log.operator}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {formattedTime}
                          </span>
                        </div>
                        <p className="text-sm font-bold text-slate-800 mt-1">
                          【{log.action}】
                        </p>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {log.details}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Child Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-t-[2.5rem] md:rounded-[3rem] shadow-2xl p-6 md:p-10 border border-white max-h-[90vh] overflow-y-auto"
            >
              <button 
                onClick={() => setIsModalOpen(false)}
                className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
              
              <div className="mb-10 flex flex-col items-center">
                <div className="w-16 h-16 bg-brand-50 text-brand-500 rounded-[1.5rem] flex items-center justify-center mb-4">
                  <PlusCircle className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-black text-slate-800 tracking-tight">新規児童の登録</h2>
                <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-1">Add new child to database</p>
              </div>

              <form onSubmit={handleCreateChild} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">姓</label>
                    <input name="lastName" required placeholder="例: 木の葉" className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold focus:bg-white focus:ring-4 focus:ring-brand-500/10 transition-all outline-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">名</label>
                    <input name="firstName" required placeholder="例: 太郎" className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold focus:bg-white focus:ring-4 focus:ring-brand-500/10 transition-all outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">せい（ふりがな）</label>
                    <input name="lastNameFurigana" placeholder="例: このは" className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold focus:bg-white focus:ring-4 focus:ring-brand-500/10 transition-all outline-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">めい（ふりがな）</label>
                    <input name="firstNameFurigana" placeholder="例: たろう" className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold focus:bg-white focus:ring-4 focus:ring-brand-500/10 transition-all outline-none" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">学校名</label>
                  <input name="school" placeholder="例: 木の葉小学校" className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold focus:bg-white focus:ring-4 focus:ring-brand-500/10 transition-all outline-none" />
                </div>
                
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-4 font-black text-slate-400 hover:text-slate-600 transition-colors tracking-widest uppercase text-xs">
                    キャンセル
                  </button>
                  <button type="submit" className="flex-[2] bg-brand-500 hover:bg-brand-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-brand-500/20 transition-all active:scale-95 tracking-widest uppercase text-xs">
                    児童を追加する
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>



      {/* Bulk Office Modal */}
      <AnimatePresence>
        {bulkOfficeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setBulkOfficeModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 border border-white z-10"
            >
              <button onClick={() => setBulkOfficeModalOpen(false)} className="absolute top-5 right-5 p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-violet-50 text-violet-500 rounded-2xl flex items-center justify-center">
                  <Tag className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-800">一括事業所変更</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{selectedIds.size} 件を対象</p>
                </div>
              </div>

              {/* Action toggle */}
              <div className="flex gap-2 mb-4">
                <button onClick={() => setBulkAction('add')}
                  className={cn("flex-1 py-2 rounded-xl text-xs font-black transition-colors",
                    bulkAction === 'add' ? "bg-violet-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200")}>
                  事業所を追加
                </button>
                <button onClick={() => setBulkAction('remove')}
                  className={cn("flex-1 py-2 rounded-xl text-xs font-black transition-colors",
                    bulkAction === 'remove' ? "bg-red-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200")}>
                  事業所を削除
                </button>
              </div>

              {/* Office select */}
              <div className="mb-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-2 block">対象事業所を選択</label>
                {masterOffices.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {masterOffices.map(office => (
                      <button key={office} onClick={() => setBulkOfficeTarget(office)}
                        className={cn("px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                          bulkOfficeTarget === office
                            ? "bg-violet-500 text-white border-violet-500"
                            : "bg-white border-slate-200 text-slate-600 hover:border-violet-300")}>
                        {office}
                      </button>
                    ))}
                  </div>
                ) : null}
                <input
                  type="text"
                  value={bulkOfficeTarget}
                  onChange={e => setBulkOfficeTarget(e.target.value)}
                  placeholder="または事業所名を直接入力"
                  className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold focus:bg-white focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 transition-all outline-none"
                />
              </div>

              <button
                onClick={applyBulkOffice}
                disabled={!bulkOfficeTarget}
                className="w-full py-4 bg-violet-500 text-white rounded-2xl font-black text-sm hover:bg-violet-600 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20"
              >
                {selectedIds.size} 件に適用する
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Import Preview Modal */}
      <AnimatePresence>
        {showImportPreview && importPreviewData && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowImportPreview(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-[90vw] h-[85vh] rounded-[3rem] shadow-2xl flex flex-col overflow-hidden border border-white"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white/50 backdrop-blur-md">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-brand-50 text-brand-500 rounded-2xl flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">インポート内容の確認</h2>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Preview and edit before import ({importPreviewData.length} records)</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => { setShowImportPreview(false); setImportCommonTags([]); setDuplicateAction('skip'); }} className="px-6 py-3 font-bold text-slate-400 hover:text-slate-600 transition-colors" disabled={isImporting}>キャンセル</button>
                  <button onClick={executeImport} disabled={isImporting} className="px-8 py-3 bg-brand-500 text-white rounded-2xl font-black shadow-lg shadow-brand-500/20 hover:bg-brand-600 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2">
                    {isImporting ? <><Loader2 className="w-4 h-4 animate-spin" /> 登録中...</> : 'この内容で登録する'}
                  </button>
                </div>
              </div>

              {/* Duplicate handling + Tag selection bar */}
              <div className="px-8 py-4 bg-slate-50/50 border-b border-slate-100 flex flex-wrap items-center gap-6 shrink-0">
                {/* Duplicate action */}
                {importPreviewData && importPreviewData.some(d => d.isDuplicate) && (
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-black text-amber-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      重複あり:
                    </span>
                    <div className="flex rounded-lg overflow-hidden border border-slate-200 text-[10px] font-black">
                      <button
                        onClick={() => setDuplicateAction('skip')}
                        className={cn("px-3 py-1.5 transition-colors", duplicateAction === 'skip' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-100')}
                      >
                        スキップ
                      </button>
                      <button
                        onClick={() => setDuplicateAction('merge')}
                        className={cn("px-3 py-1.5 transition-colors border-l border-slate-200", duplicateAction === 'merge' ? 'bg-brand-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-100')}
                      >
                        既存に統合(差分追加)
                      </button>
                    </div>
                  </div>
                )}
                {/* Office selection */}
                <div className="flex items-center gap-2 text-xs font-black text-slate-500 uppercase tracking-widest shrink-0">
                  <Tag className="w-4 h-4 text-brand-500" />
                  <span>一括事業所:</span>
                </div>
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {importCommonOffices.map(office => (
                    <span key={office} className="flex items-center gap-1 px-2 py-1 bg-brand-500 text-white rounded-lg text-[10px] font-bold">
                      {office}
                      <button onClick={() => setImportCommonOffices(prev => prev.filter(o => o !== office))} className="hover:text-red-200">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  {masterOffices.filter(o => !importCommonOffices.includes(o)).map(office => (
                    <button
                      key={office}
                      onClick={() => setImportCommonOffices(prev => [...prev, office])}
                      className="px-2 py-1 bg-white border border-slate-200 text-slate-500 rounded-lg text-[10px] font-bold hover:border-brand-300 hover:text-brand-500 transition-all"
                    >
                      + {office}
                    </button>
                  ))}
                  <div className="relative ml-2">
                    <input 
                      type="text" 
                      placeholder="新規事業所を入力..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.target.value.trim()) {
                          const val = e.target.value.trim();
                          if (!importCommonOffices.includes(val)) {
                            setImportCommonOffices(prev => [...prev, val]);
                          }
                          e.target.value = '';
                        }
                      }}
                      className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold focus:outline-none focus:border-brand-500 w-32"
                    />
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-auto custom-scrollbar p-0">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">
                      <th className="px-6 py-4 min-w-[150px]">氏名 / ふりがな</th>
                      <th className="px-4 py-4 min-w-[150px]">学校 / 学年</th>
                      <th className="px-4 py-4 min-w-[120px]">生年月日 / 性別</th>
                      <th className="px-4 py-4 min-w-[200px]">住所</th>
                      <th className="px-4 py-4 min-w-[180px]">母の連絡先・職場</th>
                      <th className="px-4 py-4 min-w-[180px]">父の連絡先・職場</th>
                      <th className="px-4 py-4 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importPreviewData.map((data) => (
                      <tr key={data.tempId} className={cn("group hover:bg-slate-50/50 transition-colors", data.isDuplicate && "bg-amber-50/30")}>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <input value={data.lastName} onChange={e => handlePreviewChange(data.tempId, 'lastName', e.target.value)} className="w-1/2 font-black text-slate-700 bg-transparent border-none p-0 focus:ring-0" placeholder="姓" />
                              <input value={data.firstName} onChange={e => handlePreviewChange(data.tempId, 'firstName', e.target.value)} className="w-1/2 font-black text-slate-700 bg-transparent border-none p-0 focus:ring-0" placeholder="名" />
                              {data.isDuplicate && (
                                <div className="shrink-0 group-hover:scale-110 transition-transform cursor-help" title="同名の児童が既に登録されています（警告）">
                                  <AlertCircle className="w-4 h-4 text-amber-500" />
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <input value={data.lastNameFurigana} onChange={e => handlePreviewChange(data.tempId, 'lastNameFurigana', e.target.value)} className="w-1/2 text-[10px] text-slate-400 font-bold bg-transparent border-none p-0 focus:ring-0" placeholder="せい" />
                              <input value={data.firstNameFurigana} onChange={e => handlePreviewChange(data.tempId, 'firstNameFurigana', e.target.value)} className="w-1/2 text-[10px] text-slate-400 font-bold bg-transparent border-none p-0 focus:ring-0" placeholder="めい" />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <input value={data.schoolName} onChange={e => handlePreviewChange(data.tempId, 'schoolName', e.target.value)} className="w-full text-xs font-bold text-slate-600 bg-transparent border-none p-0 focus:ring-0" placeholder="学校名" />
                            <input value={data.schoolGrade} onChange={e => handlePreviewChange(data.tempId, 'schoolGrade', e.target.value)} className="w-full text-[10px] text-slate-400 bg-transparent border-none p-0 focus:ring-0" placeholder="学年" />
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <input type="text" value={data.birthDate} onChange={e => handlePreviewChange(data.tempId, 'birthDate', e.target.value)} className="w-full text-xs font-bold text-slate-600 bg-transparent border-none p-0 focus:ring-0" placeholder="YYYY/MM/DD" />
                            <input value={data.gender} onChange={e => handlePreviewChange(data.tempId, 'gender', e.target.value)} className="w-full text-[10px] text-slate-400 bg-transparent border-none p-0 focus:ring-0" placeholder="性別" />
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <input value={data.address} onChange={e => handlePreviewChange(data.tempId, 'address', e.target.value)} className="w-full text-xs font-medium text-slate-500 bg-transparent border-none p-0 focus:ring-0" placeholder="住所" />
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <input value={data.contact1Phone} onChange={e => handlePreviewChange(data.tempId, 'contact1Phone', e.target.value)} className="w-full text-xs font-bold text-brand-600 bg-transparent border-none p-0 focus:ring-0" placeholder="個人の電話番号" />
                            <input value={data.workplace1Name} onChange={e => handlePreviewChange(data.tempId, 'workplace1Name', e.target.value)} className="w-full text-xs font-medium text-slate-500 bg-transparent border-none p-0 focus:ring-0" placeholder="勤務先" />
                            <input value={data.workplace1Contact} onChange={e => handlePreviewChange(data.tempId, 'workplace1Contact', e.target.value)} className="w-full text-[10px] text-slate-400 bg-transparent border-none p-0 focus:ring-0" placeholder="職場電話" />
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <input value={data.contact2Phone} onChange={e => handlePreviewChange(data.tempId, 'contact2Phone', e.target.value)} className="w-full text-xs font-bold text-brand-600 bg-transparent border-none p-0 focus:ring-0" placeholder="個人の電話番号" />
                            <input value={data.workplace2Name} onChange={e => handlePreviewChange(data.tempId, 'workplace2Name', e.target.value)} className="w-full text-xs font-medium text-slate-500 bg-transparent border-none p-0 focus:ring-0" placeholder="勤務先" />
                            <input value={data.workplace2Contact} onChange={e => handlePreviewChange(data.tempId, 'workplace2Contact', e.target.value)} className="w-full text-[10px] text-slate-400 bg-transparent border-none p-0 focus:ring-0" placeholder="職場電話" />
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <button onClick={() => removeFromImport(data.tempId)} className="p-2 text-slate-300 hover:text-rose-500 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {importPreviewData.some(d => d.isDuplicate) && (
                <div className="p-4 bg-amber-50 border-t border-amber-100 flex items-center gap-3 shrink-0">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  <p className="text-xs font-bold text-amber-700">黄色でハイライトされた行は、既に同じ名前の児童がデータベースに存在します。そのまま登録すると新しいレコードが作成されます。</p>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
