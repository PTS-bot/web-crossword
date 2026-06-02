const { createApp, ref, reactive, onMounted, computed, nextTick } = Vue;

createApp({
    setup() {
        const API_URL = '/api';

        // --- States ---
        const currentUser = ref(null);

        // Service Status Check
        const serviceStatus = reactive({
            nginx: 'ok',
            backend: 'pending',
            database: 'pending'
        });

        // Toast States
        const toast = reactive({
            show: false,
            message: '',
            type: 'info',
            timeoutId: null
        });

        const showToast = (message, type = 'info') => {
            if (toast.timeoutId) {
                clearTimeout(toast.timeoutId);
            }
            toast.message = message;
            toast.type = type;
            toast.show = true;

            toast.timeoutId = setTimeout(() => {
                toast.show = false;
            }, 4000);
        };

        const toastBorderColor = computed(() => {
            if (toast.type === 'success') return 'var(--success)';
            if (toast.type === 'error') return 'var(--danger)';
            if (toast.type === 'warning') return 'var(--warning)';
            return 'var(--primary)';
        });

        const statusClass = (status) => {
            return {
                'status-ok': status === 'ok',
                'status-pending': status === 'pending',
                'status-error': status === 'error'
            };
        };

        const checkHealth = async () => {
            serviceStatus.nginx = 'ok';
            try {
                const response = await fetch(`${API_URL}/health`, { credentials: 'include' });
                if (!response.ok) throw new Error('API server returned error');
                const data = await response.json();
                if (data.success) {
                    serviceStatus.backend = data.services.backend === 'running' ? 'ok' : 'error';
                    serviceStatus.database = data.services.database === 'connected' ? 'ok' : 'error';
                }
            } catch (error) {
                console.error('Health check failed:', error);
                serviceStatus.backend = 'error';
                serviceStatus.database = 'error';
            }
        };

        const fetchUserProfile = async () => {
            try {
                const response = await fetch(`${API_URL}/auth/profile`, { credentials: 'include' });
                const data = await response.json();
                if (data.success) {
                    allowSeedMockData.value = !!data.allowSeedMockData;
                    if (data.authenticated) {
                        currentUser.value = data.user;
                        if (data.user.role === 'admin') {
                            fetchAdminDashboardData();
                        }
                    } else {
                        currentUser.value = null;
                    }
                } else {
                    currentUser.value = null;
                }
            } catch (err) {
                console.error('Failed to fetch user session:', err);
                currentUser.value = null;
            }
        };

        const logout = async () => {
            try {
                const response = await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
                const data = await response.json();
                if (data.success) {
                    showToast('🚪 Logged out successfully', 'info');
                    currentUser.value = null;
                    setTimeout(() => {
                        window.location.href = 'admin.html#auth';
                    }, 1000);
                } else {
                    showToast('❌ Logout failed', 'error');
                }
            } catch (error) {
                showToast('❌ Connection error during logout', 'error');
            }
        };

        // --- Admin Dashboard States ---
        const dashboardUsers = ref([]);
        const dashboardScores = ref([]);
        const dashboardLoading = ref(false);
        const dashboardSearchQuery = ref('');
        const dashboardSelectedUser = ref(null);
        const dashboardMetric = ref('score'); // default: words per second
        const allowSeedMockData = ref(false);
        const csvIncludeDate = ref(false);
        let dashboardChartInstance = null;

        // Labs for performance stats
        const dashboardLabs = ref([]);
        const dashboardSelectedLabs = ref([]);
        const dashboardLabSearchQuery = ref('');
        const dashboardOnlySecondLang = ref(false);

        const filteredLabs = computed(() => {
            let labs = dashboardLabs.value;
            if (dashboardOnlySecondLang.value) {
                labs = labs.filter(l => l.hasSecondLang);
            }
            const q = dashboardLabSearchQuery.value.trim().toLowerCase();
            if (!q) return labs;
            return labs.filter(l => l.name.toLowerCase().includes(q));
        });

        const selectDashboardLab = (labName) => {
            const idx = dashboardSelectedLabs.value.indexOf(labName);
            if (idx > -1) {
                dashboardSelectedLabs.value.splice(idx, 1);
            } else {
                dashboardSelectedLabs.value.push(labName);
            }
            if (dashboardSelectedUser.value) {
                updateChart();
            }
        };

        // Watch toggle and update selection / chart
        Vue.watch(dashboardOnlySecondLang, () => {
            if (dashboardOnlySecondLang.value) {
                dashboardSelectedLabs.value = dashboardSelectedLabs.value.filter(labName => {
                    const lObj = dashboardLabs.value.find(l => l.name === labName);
                    return lObj && lObj.hasSecondLang;
                });
            }
            if (dashboardSelectedUser.value) {
                updateChart();
            }
        });

        // Metrics configuration
        const metrics = [
            { key: 'score', label: 'Words per Second', unit: 'w/s', icon: 'fa-tachometer-alt' },
            { key: 'wordCount', label: 'Words Solved', unit: 'words', icon: 'fa-puzzle-piece' },
            { key: 'revealsUsed', label: 'Clues Used', unit: 'times', icon: 'fa-eye' },
            { key: 'time', label: 'Time Taken', unit: 'sec', icon: 'fa-clock' }
        ];

        const activeMetricInfo = computed(() => {
            return metrics.find(m => m.key === dashboardMetric.value) || metrics[0];
        });

        // Format metric values for display in stats card
        const formatMetricValue = (val) => {
            if (val === undefined || val === null) return '0.00';
            return val.toFixed(2);
        };

        const changeMetric = (key) => {
            dashboardMetric.value = key;
            updateChart();
        };

        const fetchAdminDashboardData = async () => {
            dashboardLoading.value = true;
            dashboardSelectedUser.value = null;
            dashboardSelectedLabs.value = [];
            dashboardOnlySecondLang.value = false;
            if (dashboardChartInstance) {
                dashboardChartInstance.destroy();
                dashboardChartInstance = null;
            }
            try {
                const [usersRes, scoresRes, labsRes] = await Promise.all([
                    fetch(`${API_URL}/admin/users`, { credentials: 'include' }),
                    fetch(`${API_URL}/admin/scores`, { credentials: 'include' }),
                    fetch(`${API_URL}/crosswords/directories`, { credentials: 'include' })
                ]);
                const usersData = await usersRes.json();
                const scoresData = await scoresRes.json();
                const labsData = await labsRes.json();
                
                if (usersData.success) dashboardUsers.value = usersData.users;
                if (scoresData.success) dashboardScores.value = scoresData.scores;
                if (labsData.success) dashboardLabs.value = labsData.data;
            } catch (e) {
                showToast('❌ Failed to load dashboard data', 'error');
            } finally {
                dashboardLoading.value = false;
            }
        };

        const seedMockData = async () => {
            if (!confirm('This will DELETE all existing non-admin users and rankings, then create mock data. Continue?')) return;
            try {
                showToast('⏳ Seeding mock data...', 'info');
                const res = await fetch(`${API_URL}/admin/seed-mock-data`, {
                    method: 'POST',
                    credentials: 'include'
                });
                const data = await res.json();
                if (data.success) {
                    showToast(`✅ ${data.message}`, 'success');
                    await fetchAdminDashboardData();
                } else {
                    showToast(`❌ ${data.message}`, 'error');
                }
            } catch (e) {
                showToast('❌ Connection error while seeding data', 'error');
            }
        };

        const clearMockData = async () => {
            if (!confirm('This will DELETE all mock users and rankings created by Seed Mock Data. Continue?')) return;
            try {
                showToast('⏳ Clearing mock data...', 'info');
                const res = await fetch(`${API_URL}/admin/clear-mock-data`, {
                    method: 'POST',
                    credentials: 'include'
                });
                const data = await res.json();
                if (data.success) {
                    showToast(`✅ ${data.message}`, 'success');
                    await fetchAdminDashboardData();
                } else {
                    showToast(`❌ ${data.message}`, 'error');
                }
            } catch (e) {
                showToast('❌ Connection error while clearing data', 'error');
            }
        };

        const filteredUsers = computed(() => {
            const q = dashboardSearchQuery.value.trim();
            if (!q) return dashboardUsers.value;
            if (q.endsWith('*')) {
                const prefix = q.slice(0, -1).toLowerCase();
                return dashboardUsers.value.filter(u => u.username.toLowerCase().startsWith(prefix));
            }
            return dashboardUsers.value.filter(u => u.username.toLowerCase().includes(q.toLowerCase()));
        });

        const dashboardSelectedUserStats = computed(() => {
            if (!dashboardSelectedUser.value) return { rounds: 0, avg: 0, max: 0 };
            let userScores = dashboardScores.value.filter(s => s.playerName === dashboardSelectedUser.value.username);
            
            // Filter by selected labs if active (any match)
            if (dashboardSelectedLabs.value.length > 0) {
                userScores = userScores.filter(s => s.labs && s.labs.some(l => dashboardSelectedLabs.value.includes(l)));
            }
            
            // Filter by 2nd language clues if active
            if (dashboardOnlySecondLang.value) {
                userScores = userScores.filter(s => s.labsKey && s.labsKey.startsWith('(2)'));
            }
            
            if (userScores.length === 0) return { rounds: 0, avg: 0, max: 0 };
            
            const metricKey = dashboardMetric.value;
            const scores = userScores.map(s => s[metricKey] !== undefined ? s[metricKey] : 0);
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            const max = Math.max(...scores);
            return { rounds: userScores.length, avg, max };
        });

        const selectDashboardUser = async (user) => {
            dashboardSelectedUser.value = user;
            await nextTick();
            updateChart();
        };

        // Update dynamic chart average when filtered users list changes
        Vue.watch(dashboardSearchQuery, () => {
            if (dashboardSelectedUser.value) {
                updateChart();
            }
        });

        const updateChart = () => {
            const canvas = document.getElementById('userChart');
            if (!canvas) return;

            if (dashboardChartInstance) {
                dashboardChartInstance.destroy();
                dashboardChartInstance = null;
            }

            const selectedUser = dashboardSelectedUser.value;
            if (!selectedUser) return;

            const metricKey = dashboardMetric.value;
            const metricInfo = activeMetricInfo.value;

            // Get usernames in the current filter group
            const groupUsernames = new Set(filteredUsers.value.map(u => u.username));

            // Collect all scores for the filtered group
            let groupScores = dashboardScores.value.filter(s => groupUsernames.has(s.playerName));
            
            // Filter group scores by selected labs if active
            if (dashboardSelectedLabs.value.length > 0) {
                groupScores = groupScores.filter(s => s.labs && s.labs.some(l => dashboardSelectedLabs.value.includes(l)));
            }

            // Filter group scores by 2nd language clues if active
            if (dashboardOnlySecondLang.value) {
                groupScores = groupScores.filter(s => s.labsKey && s.labsKey.startsWith('(2)'));
            }

            // Build per-user metric sequences
            const perUserScores = {};
            groupScores.forEach(s => {
                if (!perUserScores[s.playerName]) perUserScores[s.playerName] = [];
                const val = s[metricKey] !== undefined ? s[metricKey] : 0;
                perUserScores[s.playerName].push(val);
            });

            // Find max rounds
            const maxRounds = Math.max(...Object.values(perUserScores).map(arr => arr.length), 0);
            if (maxRounds === 0) return;

            // Compute group average per round
            const avgPerRound = [];
            for (let round = 0; round < maxRounds; round++) {
                const vals = Object.values(perUserScores)
                    .map(arr => arr[round])
                    .filter(v => v !== undefined);
                avgPerRound.push(vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
            }

            // Selected user data
            const selectedScores = perUserScores[selectedUser.username] || [];
            const selectedData = Array.from({ length: maxRounds }, (_, i) =>
                i < selectedScores.length ? selectedScores[i] : null
            );

            // X-axis labels
            let userRawScores = dashboardScores.value.filter(s => s.playerName === selectedUser.username);
            if (dashboardSelectedLabs.value.length > 0) {
                userRawScores = userRawScores.filter(s => s.labs && s.labs.some(l => dashboardSelectedLabs.value.includes(l)));
            }
            if (dashboardOnlySecondLang.value) {
                userRawScores = userRawScores.filter(s => s.labsKey && s.labsKey.startsWith('(2)'));
            }
            const labels = Array.from({ length: maxRounds }, (_, i) => {
                const entry = userRawScores[i];
                if (entry && entry.createdAt) {
                    const d = new Date(entry.createdAt);
                    const dateStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
                    return `Round ${i + 1} (${dateStr})`;
                }
                return `Round ${i + 1}`;
            });

            const ctx = canvas.getContext('2d');
            dashboardChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: `${selectedUser.username}`,
                            data: selectedData,
                            borderColor: '#00d2ff',
                            backgroundColor: 'rgba(0, 210, 255, 0.12)',
                            borderWidth: 2.5,
                            pointBackgroundColor: '#00d2ff',
                            pointBorderColor: '#fff',
                            pointBorderWidth: 1.5,
                            pointRadius: 5,
                            pointHoverRadius: 7,
                            tension: 0.35,
                            spanGaps: false,
                            fill: true
                        },
                        {
                            label: `Group Average (${dashboardSearchQuery.value || 'All'})`,
                            data: avgPerRound,
                            borderColor: '#a855f7',
                            backgroundColor: 'rgba(168, 85, 247, 0.07)',
                            borderWidth: 2,
                            borderDash: [6, 4],
                            pointBackgroundColor: '#a855f7',
                            pointBorderColor: '#fff',
                            pointBorderWidth: 1.5,
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            tension: 0.35,
                            spanGaps: true,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                color: '#94a3b8',
                                font: { family: 'Outfit, sans-serif', size: 12 },
                                usePointStyle: true,
                                padding: 16
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(18, 24, 36, 0.95)',
                            titleColor: '#e2e8f0',
                            bodyColor: '#94a3b8',
                            borderColor: 'rgba(255,255,255,0.08)',
                            borderWidth: 1,
                            callbacks: {
                                label: (ctx) => {
                                    const v = ctx.parsed.y;
                                    return v !== null ? `${ctx.dataset.label}: ${v.toFixed(2)} ${metricInfo.unit}` : `${ctx.dataset.label}: —`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: {
                                color: '#94a3b8',
                                font: { family: 'Outfit, sans-serif', size: 11 },
                                maxRotation: 30
                            },
                            grid: { color: 'rgba(255,255,255,0.04)' }
                        },
                        y: {
                            ticks: {
                                color: '#94a3b8',
                                font: { family: 'Outfit, sans-serif', size: 11 },
                                callback: v => v.toFixed(2)
                            },
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            title: {
                                display: true,
                                text: `${metricInfo.label} (${metricInfo.unit})`,
                                color: '#64748b',
                                font: { size: 11 }
                            }
                        }
                    }
                }
            });
        };

        // --- Avatar Helpers ---
        const AVATAR_COLORS = [
            ['#7c3aed','#ede9fe'], ['#db2777','#fce7f3'], ['#0891b2','#cffafe'],
            ['#d97706','#fef3c7'], ['#059669','#d1fae5'], ['#dc2626','#fee2e2']
        ];
        const AVATAR_SYMBOLS = ['😺','🦊','🐧','🦁','🐸','🦄'];

        const getAvatarSvg = (av) => {
            if (av && av.startsWith('http')) {
                return `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.src=''"/>`;
            }
            const idx = parseInt((av || 'avatar1').replace('avatar','')) - 1;
            const safeIdx = Math.max(0, Math.min(5, isNaN(idx) ? 0 : idx));
            const [bg] = AVATAR_COLORS[safeIdx];
            const sym = AVATAR_SYMBOLS[safeIdx];
            return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><circle cx="20" cy="20" r="20" fill="${bg}"/><text x="20" y="27" text-anchor="middle" font-size="20">${sym}</text></svg>`;
        };

        const getAvatarDisplay = (av) => {
            if (!av) av = 'avatar1';
            if (av.startsWith('data:') || av.startsWith('http')) {
                return `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
            }
            return getAvatarSvg(av);
        };

        const formatRankDate = (dateStr) => {
            if (!dateStr) return '';
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        };

        const exportFilteredUsersCSV = () => {
            // Get the list of filtered user usernames
            const groupUsernames = new Set(filteredUsers.value.map(u => u.username));
            
            // Filter scores to only include those users
            let filteredScores = dashboardScores.value.filter(s => groupUsernames.has(s.playerName));
            
            // Filter by selected labs if active
            if (dashboardSelectedLabs.value.length > 0) {
                filteredScores = filteredScores.filter(s => s.labs && s.labs.some(l => dashboardSelectedLabs.value.includes(l)));
            }
            
            // Filter by 2nd language clues if active
            if (dashboardOnlySecondLang.value) {
                filteredScores = filteredScores.filter(s => s.labsKey && s.labsKey.startsWith('(2)'));
            }
            
            // Sort by playerName, then createdAt
            filteredScores.sort((a, b) => {
                if (a.playerName !== b.playerName) {
                    return a.playerName.localeCompare(b.playerName);
                }
                return new Date(a.createdAt) - new Date(b.createdAt);
            });
            
            // Get the currently selected metric key
            const metricKey = dashboardMetric.value; // e.g. 'score', 'wordCount', 'revealsUsed', 'time'
            const metricInfo = activeMetricInfo.value;
            const includeDate = csvIncludeDate.value;
            
            // Group scores by username, preserving round order
            const userRoundsMap = {}; // { username: [ {value, date}, ... ] }
            let maxRounds = 0;
            
            filteredScores.forEach(s => {
                const username = s.playerName;
                if (!userRoundsMap[username]) {
                    userRoundsMap[username] = [];
                }
                const val = s[metricKey] !== undefined ? (typeof s[metricKey] === 'number' ? s[metricKey].toFixed(4) : String(s[metricKey])) : '0';
                const dateStr = s.createdAt ? new Date(s.createdAt).toISOString() : '';
                userRoundsMap[username].push({ val, dateStr });
                if (userRoundsMap[username].length > maxRounds) {
                    maxRounds = userRoundsMap[username].length;
                }
            });
            
            // Build headers: Username, Round 1, Round 2, ..., Round N
            const headers = ['Username'];
            for (let i = 1; i <= maxRounds; i++) {
                headers.push(`Round ${i}`);
            }
            const rows = [headers];
            
            // Build rows: one per unique username
            const sortedUsernames = Object.keys(userRoundsMap).sort((a, b) => a.localeCompare(b));
            sortedUsernames.forEach(username => {
                const rounds = userRoundsMap[username];
                const row = [username];
                for (let i = 0; i < maxRounds; i++) {
                    if (i < rounds.length) {
                        if (includeDate && rounds[i].dateStr) {
                            row.push(`${rounds[i].val}(${rounds[i].dateStr})`);
                        } else {
                            row.push(rounds[i].val);
                        }
                    } else {
                        row.push(''); // empty cell if this user has fewer rounds
                    }
                }
                rows.push(row);
            });
            
            // Convert to CSV format with UTF-8 BOM for Thai/English Excel support
            const csvContent = "\uFEFF" + rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            
            const secondLangText = dashboardOnlySecondLang.value ? '_2ndLang' : '';
            const labText = dashboardSelectedLabs.value.length > 0 ? `_${dashboardSelectedLabs.value.join('_')}` : '';
            const filterText = dashboardSearchQuery.value.trim() ? `_${dashboardSearchQuery.value.trim().replace(/[*?]/g, '')}` : '';
            const metricText = `_${metricKey}`;
            link.setAttribute('href', url);
            link.setAttribute('download', `user_performance_export${filterText}${labText}${secondLangText}${metricText}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showToast(`📊 CSV exported (${metricInfo.label}) — ${sortedUsernames.length} users, max ${maxRounds} rounds`, 'success');
        };

        onMounted(() => {
            checkHealth();
            setInterval(checkHealth, 10000);
            fetchUserProfile();
        });

        return {
            currentUser,
            serviceStatus,
            toast,
            toastBorderColor,
            statusClass,
            checkHealth,
            logout,

            // Dashboard States & Methods
            dashboardUsers,
            dashboardScores,
            dashboardLoading,
            dashboardSearchQuery,
            dashboardSelectedUser,
            dashboardMetric,
            metrics,
            activeMetricInfo,
            formatMetricValue,
            changeMetric,
            fetchAdminDashboardData,
            seedMockData,
            clearMockData,
            allowSeedMockData,
            filteredUsers,
            dashboardSelectedUserStats,
            selectDashboardUser,
            updateChart,
            exportFilteredUsersCSV,
            csvIncludeDate,
            
            // Labs filtering
            dashboardLabs,
            dashboardSelectedLabs,
            dashboardLabSearchQuery,
            dashboardOnlySecondLang,
            filteredLabs,
            selectDashboardLab,

            // Helpers
            getAvatarDisplay,
            formatRankDate
        };
    }
}).mount('#app');
