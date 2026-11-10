import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <main className="fatal"><h1>界面暂时遇到问题</h1><p>已保存的项目不会被删除。请刷新页面重新连接。</p><button className="primary" onClick={() => location.reload()}>刷新页面</button><details><summary>错误摘要</summary><pre>{this.state.error}</pre></details></main> : this.props.children; }
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
