# TreeKids 顧客管理システム (Kids Management App)

児童発達支援および放課後等デイサービス向けの児童（生徒）情報一元管理アプリケーションです。  
直感的な Bento-Grid UI と高速なリアルタイム同期（Firebase Firestore）を備え、他システム（octopus、書類管理、調理・療育記録システム等）とのシームレスなデータ連携を実現しています。

---

## 🚀 主な機能

### 1. 児童基本情報・プロファイル管理
* **氏名・ふりがな管理**: 姓・名の分割管理および他アプリ連携用のフルネーム（`name`, `fullName`, `nameFurigana`, `nameKana`）の自動生成・同期。
* **生年月日・学年自動計算**: 生年月日から日本の学齢（4月1日基準）に基づき、年齢および学年（未就学、年少〜年長、小1〜小6、中1〜中3、高1〜高3、一般）を自動算出。
* **連絡先・所在地**: 自宅住所、緊急連絡先、保護者勤務先（続柄・勤務先名・電話番号）の多重管理。
* **家族構成**: 家族メンバーの氏名・年齢・続柄・連絡先の一覧管理。
* **特性・医療情報**: 障がい名、手帳種類・等級、本人の性格、希望する支援、アレルギー情報および詳細メモ。

### 2. サービス区分（放課後等デイ / 児発）の自動判定
* **学齢による自動判定**: 小学生以上（小1以上）は「放課後等デイサービス」、未就学児は「児童発達支援」として自動判定・バッジ表示。
* **他アプリ共通ステータス**: `serviceType`, `serviceCategory`, `isHoukagoDay` をデータベースに自動保存。
* **手動切り替え**: 契約形態や特例に合わせて画面上から手動で上書き変更可能。

### 3. 事業所タグ管理
* **統合候補タグ表示**: システムマスタおよび全児童で使われているタグ（「ホーム」「サーチ」「Tree Kids School Home」等）をワンクリック候補ボタン（`+`）として一覧表示。
* **自由タグ入力**: 新しい事業所タグをその場でテキスト入力して即座に追加可能。
* **事業所別フィルタリング**: ヘッダーのチップから事業所ごとに児童リストを絞り込み表示。

### 4. 完全バックアップ・データ復元 (JSON / CSV)
* **システム完全バックアップ (JSON)**: 児童データ（`children`）に加え、日報（`daily_reports`）、事業所（`offices`）、操作ログ（`logs`）、スタッフ（`staff`）など全コレクションを1つのJSONファイルにパック出力。
* **全コレクション一括復元 (JSONインポート)**: バックアップファイルを読み込み、内訳（件数）をプレビュー確認した上で各コレクションへ安全に一括書き戻し。
* **Excel確認用エクスポート (CSV)**: 全児童の全項目をフラットな行データに変換し、Excel文字化け防止のBOM付きCSVとして出力。
* **CSVインポート**: 外部CSVファイルから児童データを一括取り込み・新規登録（文字コード自動判定、プレビュー編集機能付き）。

### 5. 操作履歴ログ
* 児童の新規登録、情報更新、アーカイブ、削除、インポート、バックアップ復元などの主要操作を自動記録。
* 操作者、実行日時、操作内容の詳細を直近100件までモーダルで閲覧可能。

### 6. 一括操作モード (Bulk Actions)
* 複数児童を選択し、一括で事業所タグの追加・削除、一括アーカイブ、一括完全削除を実行可能。

---

## 🛠️ 技術スタック

* **フロントエンド**: [React 19](https://react.dev/) + [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
* **スタイリング**: [Tailwind CSS](https://tailwindcss.com/) + [clsx](https://github.com/lukeed/clsx) + [tailwind-merge](https://github.com/dcastil/tailwind-merge)
* **アニメーション**: [Framer Motion](https://www.framer.com/motion/)
* **アイコン**: [Lucide React](https://lucide.dev/)
* **CSV処理**: [PapaParse](https://www.papaparse.com/)
* **バックエンド / DB**: [Firebase Firestore](https://firebase.google.com/docs/firestore) + [Firebase Auth](https://firebase.google.com/docs/auth) + [Firebase Hosting](https://firebase.google.com/docs/hosting)

---

## 📁 ディレクトリ構成

```text
child-management-standalone/
├── dist/                 # プロダクションビルド成果物
├── public/               # 静的アセット (ファビコン, SVGアイコン等)
├── src/
│   ├── assets/           # 画像・アセット
│   ├── App.jsx           # メインアプリケーションコンポーネント
│   ├── firebase.ts       # Firebase初期化・接続設定
│   ├── index.css         # Tailwind基本スタイル & カスタムCSS
│   └── main.jsx          # エントリーポイント
├── .firebaserc           # Firebaseプロジェクト構成
├── firebase.json         # Hosting & Firestoreデプロイ設定
├── firestore.rules       # Firestoreセキュリティルール
├── package.json          # プロジェクト依存関係 & スクリプト
├── tailwind.config.js    # Tailwind設定
├── tsconfig.json         # TypeScript設定
├── vite.config.js        # Viteビルド設定
└── README.md             # プロジェクト説明書
```

---

## 💻 開発・ビルド手順

### 1. 依存関係のインストール
```bash
npm install
```

### 2. ローカル開発サーバーの起動
```bash
npm run dev
```

### 3. プロダクションビルド
```bash
npm run build
```

### 4. Firebase Hostingへのデプロイ
```bash
npx firebase deploy
```

---

## 🔒 セキュリティとデータ連携

* **Firestoreセキュリティルール**: 認証済みユーザーによる安全な読み書き制限を適用。
* **他アプリ互換性**: 各ドキュメントには標準的な `name`, `fullName`, `serviceType` 等を常時同期しているため、同一プロジェクトに接続する他アプリからも追加設定なしで児童情報を参照可能です。

---

© TreeKids School. All Rights Reserved.
