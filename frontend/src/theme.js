import { createTheme } from '@mui/material/styles';
export const theme=createTheme({
  palette:{
    mode:'light',
    primary:{main:'#526d80',dark:'#425c6f',light:'#eaf0f3'},
    background:{default:'#f5f7f8',paper:'#ffffff'},
    text:{primary:'#243b4e',secondary:'#596b7a'},
    divider:'#dfe6eb'
  },
  typography:{fontFamily:'"Inter","Segoe UI", Roboto, Arial, sans-serif',fontSize:11,htmlFontSize:16,body1:{fontSize:11},body2:{fontSize:10},caption:{fontSize:10},button:{textTransform:'none',fontSize:11}},
  shape:{borderRadius:12},
  components:{MuiCssBaseline:{styleOverrides:{body:{margin:0}}},MuiPaper:{styleOverrides:{root:{backgroundImage:'none'}}}}
});
